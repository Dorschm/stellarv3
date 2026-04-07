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
import { Player, PlayerType, TerraNullius, UnitType } from "./Game";
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
    troops: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_SENT, troops);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, troops);
    }
  }

  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addAttack(player, ATTACK_INDEX_CANCEL, troops);
    this._addAttack(player, ATTACK_INDEX_SENT, -troops);
    if (target.isPlayer()) {
      this._addAttack(target, ATTACK_INDEX_RECV, -troops);
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

  shuttleSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "ashuttle", SHUTTLE_INDEX_SENT, 1);
  }

  shuttleArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: BigIntLike,
  ): void {
    this._addSpaceUnit(player, "ashuttle", SHUTTLE_INDEX_ARRIVE, 1);
  }

  shuttleDestroyTroops(
    player: Player,
    target: Player,
    troops: BigIntLike,
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
  }

  frigateSelfTrade(player: Player, credits: BigIntLike): void {
    this._addCredits(player, CREDITS_INDEX_FRIGATE_SELF, credits);
  }

  frigateExternalTrade(player: Player, credits: BigIntLike): void {
    this._addCredits(player, CREDITS_INDEX_FRIGATE_OTHER, credits);
  }

  lobbyFillTime(fillTimeMs: number): void {}
}
