import { AllPlayersStats } from "../Schemas";
import {
  ATTACK_INDEX_CANCEL,
  ATTACK_INDEX_RECV,
  ATTACK_INDEX_SENT,
  BOMB_INDEX_INTERCEPT,
  BOMB_INDEX_LAND,
  BOMB_INDEX_LAUNCH,
  CREDITS_INDEX_FRIGATE_OTHER,
  CREDITS_INDEX_FRIGATE_SELF,
  CREDITS_INDEX_STEAL,
  CREDITS_INDEX_TRADE,
  CREDITS_INDEX_WAR,
  CREDITS_INDEX_WORK,
  NukeType,
  OTHER_INDEX_BUILT,
  OTHER_INDEX_CAPTURE,
  OTHER_INDEX_DESTROY,
  OTHER_INDEX_LOST,
  OTHER_INDEX_UPGRADE,
  OtherUnitType,
  PLAYER_INDEX_BOT,
  PLAYER_INDEX_HUMAN,
  PLAYER_INDEX_NATION,
  PlayerStats,
  SHUTTLE_INDEX_ARRIVE,
  SHUTTLE_INDEX_CAPTURE,
  SHUTTLE_INDEX_DESTROY,
  SHUTTLE_INDEX_SENT,
  SpaceUnit,
  unitTypeToBombUnit,
  unitTypeToOtherUnit,
} from "../StatsSchemas";
import {
  Player,
  PlayerType,
  RunPlayerScore,
  RunScore,
  TerraNullius,
  UnitType,
  WinCondition,
} from "./Game";
import { SectorMap } from "./SectorMap";
import { Stats } from "./Stats";

type BigIntLike = bigint | number;
function _bigint(value: BigIntLike): bigint {
  switch (typeof value) {
    case "bigint":
      return value;
    case "number":
      return BigInt(Math.floor(value));
  }
}

const conquest_by_type: Record<PlayerType, number> = {
  [PlayerType.Human]: PLAYER_INDEX_HUMAN,
  [PlayerType.Nation]: PLAYER_INDEX_NATION,
  [PlayerType.Bot]: PLAYER_INDEX_BOT,
};

export class StatsImpl implements Stats {
  private readonly data: AllPlayersStats = {};

  private _numClusterWarheadLaunched: bigint = 0n;

  // GDD §10 scoring book-keeping. Indexed by `player.smallID()` so we can
  // serve queries without iterating the player set on every tick.
  // - sectorsEverOwned: distinct sector IDs the player has ever owned.
  //   These IDs are identical to the `Planet.sectorId` / `Planet.id` of
  //   the corresponding Planet entity, so the cardinality doubles as the
  //   GDD §10 "planets conquered" metric surfaced on the RunScore.
  // - eliminationOrder: rank assigned at first kill (1 = first eliminated)
  // - eliminationTick: tick of the first kill, used for survivalTicks
  private readonly sectorsEverOwned: Map<number, Set<number>> = new Map();
  private readonly eliminationOrder: Map<number, number> = new Map();
  private readonly eliminationTick: Map<number, number> = new Map();
  private nextEliminationRank = 1;
  private sectorMap: SectorMap | null = null;

  setSectorMap(sectorMap: SectorMap): void {
    this.sectorMap = sectorMap;
  }

  recordSectorConquest(player: Player, sectorId: number): void {
    if (sectorId <= 0) return;
    const id = player.smallID();
    let set = this.sectorsEverOwned.get(id);
    if (set === undefined) {
      set = new Set<number>();
      this.sectorsEverOwned.set(id, set);
    }
    set.add(sectorId);
  }

  recordEliminationOrder(player: Player): number {
    const id = player.smallID();
    const existing = this.eliminationOrder.get(id);
    if (existing !== undefined) return existing;
    const rank = this.nextEliminationRank++;
    this.eliminationOrder.set(id, rank);
    return rank;
  }

  runScore(
    players: Player[],
    tick: number,
    winCondition: WinCondition,
  ): RunScore | null {
    const sectorMap = this.sectorMap;
    if (sectorMap === null) return null;

    // Survivors get ranks above all eliminated players, ordered by current
    // tile count so that "last to lose territory" stays the highest rank
    // (matches GDD §12 — "last eliminated = highest rank").
    const survivors = players
      .filter((p) => !this.eliminationOrder.has(p.smallID()))
      .slice()
      .sort((a, b) => a.numTilesOwned() - b.numTilesOwned());

    let survivorRank = this.nextEliminationRank;
    const survivorRankBy = new Map<number, number>();
    for (const p of survivors) {
      survivorRankBy.set(p.smallID(), survivorRank++);
    }

    const playerScores: RunPlayerScore[] = players.map((p) => {
      const id = p.smallID();
      const eliminated = this.eliminationOrder.get(id);
      const survivorRankValue = survivorRankBy.get(id);
      const eliminationRank =
        eliminated ?? survivorRankValue ?? this.nextEliminationRank;
      const killedAt = this.eliminationTick.get(id);
      const survivalTicks = killedAt ?? tick;
      // Currently-controlled planets: any sector-turned-Planet containing
      // at least one tile this player owns. The sector id numeric space
      // is shared with `Planet.sectorId`, so counting distinct sector ids
      // is equivalent to counting distinct Planet entities — we walk
      // tiles instead of planets to keep the cost O(player tiles) rather
      // than O(map tiles).
      const currentSectors = new Set<number>();
      for (const tile of p.tiles()) {
        const sid = sectorMap.sectorOf(tile);
        if (sid > 0) currentSectors.add(sid);
      }
      const planetsConquered = (this.sectorsEverOwned.get(id) ?? new Set())
        .size;
      return {
        clientID: p.clientID(),
        playerID: p.id(),
        name: p.name(),
        planetsConquered,
        systemsControlled: currentSectors.size,
        survivalTicks,
        eliminationRank,
      };
    });

    // Sort by elimination rank desc so winners appear first.
    playerScores.sort((a, b) => b.eliminationRank - a.eliminationRank);

    return {
      totalTicks: tick,
      winCondition,
      players: playerScores,
    };
  }

  numClusterWarheadsLaunched(): bigint {
    return this._numClusterWarheadLaunched;
  }

  getPlayerStats(player: Player): PlayerStats {
    const clientID = player.clientID();
    if (clientID === null) return undefined;
    return this.data[clientID];
  }

  stats() {
    return this.data;
  }

  private _makePlayerStats(player: Player): PlayerStats {
    const clientID = player.clientID();
    if (clientID === null) return undefined;
    if (clientID in this.data) {
      return this.data[clientID];
    }
    const data = {} satisfies PlayerStats;
    this.data[clientID] = data;
    return data;
  }

  private _addAttack(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.attacks ??= [0n];
    while (p.attacks.length <= index) p.attacks.push(0n);
    p.attacks[index] += _bigint(value);
  }

  private _addBetrayal(player: Player, value: BigIntLike) {
    const data = this._makePlayerStats(player);
    if (data === undefined) return;
    data.betrayals ??= 0n;
    data.betrayals += _bigint(value);
  }

  private _addSpaceUnit(
    player: Player,
    type: SpaceUnit,
    index: number,
    value: BigIntLike,
  ) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.shuttles ??= { [type]: [0n] };
    p.shuttles[type] ??= [0n];
    while (p.shuttles[type].length <= index) p.shuttles[type].push(0n);
    p.shuttles[type][index] += _bigint(value);
  }

  private _addBomb(
    player: Player,
    nukeType: NukeType,
    index: number,
    value: BigIntLike,
  ): void {
    const type = unitTypeToBombUnit[nukeType];
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.bombs ??= { [type]: [0n] };
    p.bombs[type] ??= [0n];
    while (p.bombs[type].length <= index) p.bombs[type].push(0n);
    p.bombs[type][index] += _bigint(value);
  }

  private _addCredits(player: Player, index: number, value: BigIntLike) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.credits ??= [0n];
    while (p.credits.length <= index) p.credits.push(0n);
    p.credits[index] += _bigint(value);
  }

  private _addOtherUnit(
    player: Player,
    otherUnitType: OtherUnitType,
    index: number,
    value: BigIntLike,
  ) {
    const type = unitTypeToOtherUnit[otherUnitType];
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.units ??= { [type]: [0n] };
    p.units[type] ??= [0n];
    while (p.units[type].length <= index) p.units[type].push(0n);
    p.units[type][index] += _bigint(value);
  }

  private _addConquest(player: Player, index: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.conquests ??= [0n];
    while (p.conquests.length <= index) p.conquests.push(0n);
    p.conquests[index] += _bigint(1);
  }

  private _addPlayerKilled(player: Player, tick: number) {
    const p = this._makePlayerStats(player);
    if (p === undefined) return;
    p.killedAt = _bigint(tick);
  }

  attack(
    player: Player,
    target: Player | TerraNullius,
    population: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_SENT, population);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, population);
    }
  }

  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    population: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_CANCEL, population);
    this._addAttack(player, ATTACK_INDEX_SENT, -population);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, -population);
    }
  }

  betray(player: Player): void {
    this._addBetrayal(player, 1);
  }

  freighterSendTrade(player: Player, target: Player): void {
    this._addSpaceUnit(player, "tfreight", SHUTTLE_INDEX_SENT, 1);
  }

  freighterArriveTrade(
    player: Player,
    target: Player,
    credits: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "tfreight", SHUTTLE_INDEX_ARRIVE, 1);
    this._addCredits(player, CREDITS_INDEX_TRADE, credits);
    this._addCredits(target, CREDITS_INDEX_TRADE, credits);
  }

  freighterCapturedTrade(
    player: Player,
    target: Player,
    credits: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "tfreight", SHUTTLE_INDEX_CAPTURE, 1);
    this._addCredits(player, CREDITS_INDEX_STEAL, credits);
  }

  freighterDestroyTrade(player: Player, target: Player): void {
    this._addSpaceUnit(player, "tfreight", SHUTTLE_INDEX_DESTROY, 1);
  }

  shuttleSendPopulation(
    player: Player,
    target: Player | TerraNullius,
    population: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "ashuttle", SHUTTLE_INDEX_SENT, 1);
  }

  shuttleArrivePopulation(
    player: Player,
    target: Player | TerraNullius,
    population: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "ashuttle", SHUTTLE_INDEX_ARRIVE, 1);
  }

  shuttleDestroyPopulation(
    player: Player,
    target: Player,
    population: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "ashuttle", SHUTTLE_INDEX_DESTROY, 1);
  }

  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    if (type === UnitType.ClusterWarhead) {
      this._numClusterWarheadLaunched++;
    }
    this._addBomb(player, type, BOMB_INDEX_LAUNCH, 1);
  }

  bombLand(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void {
    this._addBomb(player, type, BOMB_INDEX_LAND, 1);
  }

  bombIntercept(player: Player, type: NukeType, count: BigIntLike): void {
    this._addBomb(player, type, BOMB_INDEX_INTERCEPT, count);
  }

  creditsWork(player: Player, credits: BigIntLike): void {
    this._addCredits(player, CREDITS_INDEX_WORK, credits);
  }

  creditsWar(player: Player, captured: Player, credits: BigIntLike): void {
    this._addCredits(player, CREDITS_INDEX_WAR, credits);
    const conquestType = conquest_by_type[captured.type()];
    if (conquestType !== undefined) {
      this._addConquest(player, conquestType);
    }
  }

  unitBuild(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_BUILT, 1);
  }

  unitCapture(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_CAPTURE, 1);
  }

  unitUpgrade(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_UPGRADE, 1);
  }

  unitDestroy(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_DESTROY, 1);
  }

  unitLose(player: Player, type: OtherUnitType): void {
    this._addOtherUnit(player, type, OTHER_INDEX_LOST, 1);
  }

  playerKilled(player: Player, tick: number): void {
    this._addPlayerKilled(player, tick);
    // Track elimination ordering for the GDD scoring breakdown. Use
    // recordEliminationOrder() so the call is idempotent if PlayerExecution
    // re-fires after the player has already been recorded.
    if (!this.eliminationOrder.has(player.smallID())) {
      this.recordEliminationOrder(player);
      this.eliminationTick.set(player.smallID(), tick);
    }
  }

  frigateSelfTrade(player: Player, credits: BigIntLike): void {
    this._addCredits(player, CREDITS_INDEX_FRIGATE_SELF, credits);
  }

  frigateExternalTrade(player: Player, credits: BigIntLike): void {
    this._addCredits(player, CREDITS_INDEX_FRIGATE_OTHER, credits);
  }

  lobbyFillTime(fillTimeMs: number): void {}
}
