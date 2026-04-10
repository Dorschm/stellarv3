import { renderNumber } from "../../client/Utils";
import { Config } from "../configuration/Config";
import {
  AbstractGraph,
  AbstractGraphBuilder,
} from "../pathfinding/algorithms/AbstractGraph";
import { AStarDeepSpaceHierarchical } from "../pathfinding/algorithms/AStar.DeepSpaceHierarchical";
import { PathFinder } from "../pathfinding/types";
import { perfBegin, perfEnd, perfIsEnabled, perfRecord } from "../PerfCounter";
import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import { ATTACK_INDEX_SENT } from "../StatsSchemas";
import { simpleHash } from "../Util";
import { AllianceImpl } from "./AllianceImpl";
import { AllianceRequestImpl } from "./AllianceRequestImpl";
import {
  Alliance,
  AllianceRequest,
  Cell,
  ColoredTeams,
  Duos,
  EmojiMessage,
  Execution,
  Game,
  GameMode,
  GameUpdates,
  HumansVsNations,
  MessageType,
  MutableAlliance,
  Nation,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
  Quads,
  RunScore,
  SpawnArea,
  Team,
  TeamGameSpawnAreas,
  TerrainType,
  TerraNullius,
  Trios,
  Unit,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { GameUpdate, GameUpdateType } from "./GameUpdates";
import { HyperspaceLaneNetwork } from "./HyperspaceLaneNetwork";
import { createHyperspaceLaneNetwork } from "./HyperspaceLaneNetworkImpl";
import { MotionPlanRecord, packMotionPlans } from "./MotionPlans";
import { PlayerImpl } from "./PlayerImpl";
import { SectorMap } from "./SectorMap";
import { Stats } from "./Stats";
import { StatsImpl } from "./StatsImpl";
import { assignTeams } from "./TeamAssignment";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "./UnitGrid";

/**
 * Structural type for the optional `setSectorMap` hook on `DefaultConfig`.
 * Kept local to avoid a hard import of `DefaultConfig` from this layer
 * (which would invert the configuration → game dependency direction).
 */
interface DefaultConfigLike {
  setSectorMap(sm: SectorMap): void;
}

export function createGame(
  humans: PlayerInfo[],
  nations: Nation[],
  gameMap: GameMap,
  miniGameMap: GameMap,
  config: Config,
  teamGameSpawnAreas?: TeamGameSpawnAreas,
): Game {
  const stats = new StatsImpl();
  return new GameImpl(
    humans,
    nations,
    gameMap,
    miniGameMap,
    config,
    stats,
    teamGameSpawnAreas,
  );
}

export type CellString = string;

export class GameImpl implements Game {
  private _ticks = 0;

  private unInitExecs: Execution[] = [];

  _players: Map<PlayerID, PlayerImpl> = new Map<PlayerID, PlayerImpl>();
  _playersBySmallID: Player[] = [];

  private execs: Execution[] = [];
  private _width: number;
  private _height: number;
  _terraNullius: TerraNulliusImpl;

  allianceRequests: AllianceRequestImpl[] = [];
  alliances_: AllianceImpl[] = [];

  private nextPlayerID = 1;
  private _nextUnitID = 1;

  private updates: GameUpdates = createGameUpdatesMap();
  private tileUpdatePairs: number[] = [];
  private motionPlanRecords: MotionPlanRecord[] = [];
  private planDrivenUnitIds = new Set<number>();
  private unitGrid: UnitGrid;

  private playerTeams: Team[] = [];
  private botTeam: Team = ColoredTeams.Bot;
  private _hyperspaceLaneNetwork: HyperspaceLaneNetwork =
    createHyperspaceLaneNetwork(this);

  // Used to assign unique IDs to each new alliance
  private nextAllianceID: number = 0;

  private _isPaused: boolean = false;
  private _winner: Player | Team | null = null;
  private _miniDeepSpaceGraph: AbstractGraph | null = null;
  private _miniDeepSpaceHPA: AStarDeepSpaceHierarchical | null = null;
  private _teamGameSpawnAreas: TeamGameSpawnAreas | undefined;
  private _sectorMap: SectorMap;

  constructor(
    private _humans: PlayerInfo[],
    private _nations: Nation[],
    private _map: GameMap,
    private miniGameMap: GameMap,
    private _config: Config,
    private _stats: Stats,
    teamGameSpawnAreas?: TeamGameSpawnAreas,
  ) {
    const constructorStart = performance.now();

    this._teamGameSpawnAreas = teamGameSpawnAreas;
    this._terraNullius = new TerraNulliusImpl();
    this._width = _map.width();
    this._height = _map.height();
    this.unitGrid = new UnitGrid(this._map);

    // Build the SectorMap from manifest nation seeds. With an empty
    // nations[] (e.g., the `plains` test maps), every sector ID is 0 and
    // the (forthcoming) economy bonuses fall back to the existing formulas.
    this._sectorMap = new SectorMap(
      this._map,
      this._nations.map((n) =>
        n.spawnCell ? { x: n.spawnCell.x, y: n.spawnCell.y } : undefined,
      ),
    );
    const maybeDefaultConfig = _config as unknown as Partial<DefaultConfigLike>;
    if (typeof maybeDefaultConfig.setSectorMap === "function") {
      maybeDefaultConfig.setSectorMap(this._sectorMap);
    }
    // Hand the SectorMap to the Stats tracker so RunScore can resolve
    // tile -> sector for the GDD §10 scoring breakdown.
    this._stats.setSectorMap(this._sectorMap);

    if (_config.gameConfig().gameMode === GameMode.Team) {
      this.populateTeams();
    }
    this.addPlayers();

    if (!_config.disableNavMesh()) {
      const graphBuilder = new AbstractGraphBuilder(this.miniGameMap);
      this._miniDeepSpaceGraph = graphBuilder.build();

      this._miniDeepSpaceHPA = new AStarDeepSpaceHierarchical(
        this.miniGameMap,
        this._miniDeepSpaceGraph,
        { cachePaths: true },
      );
    }

    console.log(
      `[GameImpl] Constructor total: ${(performance.now() - constructorStart).toFixed(0)}ms`,
    );
  }

  private populateTeams() {
    let numPlayerTeams = this._config.playerTeams();

    // HumansVsNations mode always has exactly 2 teams
    if (numPlayerTeams === HumansVsNations) {
      this.playerTeams = [ColoredTeams.Humans, ColoredTeams.Nations];
      return;
    }

    if (typeof numPlayerTeams !== "number") {
      const players = this._humans.length + this._nations.length;
      switch (numPlayerTeams) {
        case Duos:
          numPlayerTeams = Math.ceil(players / 2);
          break;
        case Trios:
          numPlayerTeams = Math.ceil(players / 3);
          break;
        case Quads:
          numPlayerTeams = Math.ceil(players / 4);
          break;
        default:
          throw new Error(`Unknown TeamCountConfig ${numPlayerTeams}`);
      }
    }
    if (numPlayerTeams < 2) {
      throw new Error(`Too few teams: ${numPlayerTeams}`);
    } else if (numPlayerTeams < 8) {
      this.playerTeams = [ColoredTeams.Red, ColoredTeams.Blue];
      if (numPlayerTeams >= 3) this.playerTeams.push(ColoredTeams.Yellow);
      if (numPlayerTeams >= 4) this.playerTeams.push(ColoredTeams.Green);
      if (numPlayerTeams >= 5) this.playerTeams.push(ColoredTeams.Purple);
      if (numPlayerTeams >= 6) this.playerTeams.push(ColoredTeams.Orange);
      if (numPlayerTeams >= 7) this.playerTeams.push(ColoredTeams.Teal);
    } else {
      this.playerTeams = [];
      for (let i = 1; i <= numPlayerTeams; i++) {
        this.playerTeams.push(`Team ${i}`);
      }
    }
  }

  private addPlayers() {
    if (this.config().gameConfig().gameMode === GameMode.FFA) {
      this._humans.forEach((p) => this.addPlayer(p));
      this._nations.forEach((n) => this.addPlayer(n.playerInfo));
      return;
    }

    if (this._config.playerTeams() === HumansVsNations) {
      this._humans.forEach((p) => this.addPlayer(p, ColoredTeams.Humans));
      this._nations.forEach((n) =>
        this.addPlayer(n.playerInfo, ColoredTeams.Nations),
      );
      return;
    }

    // Team mode
    const allPlayers = [
      ...this._humans,
      ...this._nations.map((n) => n.playerInfo),
    ];
    const playerToTeam = assignTeams(allPlayers, this.playerTeams);
    for (const [playerInfo, team] of playerToTeam.entries()) {
      if (team === "kicked") {
        console.warn(`Player ${playerInfo.name} was kicked from team`);
        continue;
      }
      this.addPlayer(playerInfo, team);
    }
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  owner(ref: TileRef): Player | TerraNullius {
    return this.playerBySmallID(this.ownerID(ref));
  }

  alliances(): MutableAlliance[] {
    return this.alliances_;
  }

  playerBySmallID(id: number): Player | TerraNullius {
    if (id === 0) {
      return this.terraNullius();
    }
    return this._playersBySmallID[id - 1];
  }
  map(): GameMap {
    return this._map;
  }
  miniMap(): GameMap {
    return this.miniGameMap;
  }

  addUpdate(update: GameUpdate) {
    (this.updates[update.type] as GameUpdate[]).push(update);
  }

  nextUnitID(): number {
    const old = this._nextUnitID;
    this._nextUnitID++;
    return old;
  }

  setFallout(tile: TileRef, value: boolean) {
    if (value && this.hasOwner(tile)) {
      throw Error(`cannot set fallout, tile ${tile} has owner`);
    }
    if (this._map.hasFallout(tile)) {
      return;
    }
    this._map.setFallout(tile, value);
    this.recordTileUpdate(tile);
  }

  units(...types: UnitType[]): Unit[] {
    return Array.from(this._players.values()).flatMap((p) => p.units(...types));
  }

  unitCount(type: UnitType): number {
    let total = 0;
    for (const player of this._players.values()) {
      total += player.unitCount(type);
    }
    return total;
  }

  unitInfo(type: UnitType): UnitInfo {
    return this.config().unitInfo(type);
  }

  nations(): Nation[] {
    return this._nations;
  }

  sectorMap(): SectorMap {
    return this._sectorMap;
  }

  // GDD §4 / Ticket 6 — shared per-tile scout swarm terraform accumulator.
  // Stored as a sparse Map because terraforming is a rare event relative to
  // the tile count; instantiating a dense array sized to the whole map would
  // waste memory for the handful of tiles that ever accumulate progress.
  private _scoutSwarmProgress: Map<TileRef, number> = new Map();

  recordScoutSwarmTerraformProgress(tile: TileRef): number {
    const next = (this._scoutSwarmProgress.get(tile) ?? 0) + 1;
    this._scoutSwarmProgress.set(tile, next);
    return next;
  }

  resetScoutSwarmTerraformProgress(tile: TileRef): void {
    this._scoutSwarmProgress.delete(tile);
  }

  scoutSwarmTerraformProgress(tile: TileRef): number {
    return this._scoutSwarmProgress.get(tile) ?? 0;
  }

  createAllianceRequest(
    requestor: Player,
    recipient: Player,
  ): AllianceRequest | null {
    if (requestor.isAlliedWith(recipient)) {
      console.log("cannot request alliance, already allied");
      return null;
    }
    if (
      recipient
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === requestor) !== undefined
    ) {
      console.log(`duplicate alliance request from ${requestor.name()}`);
      return null;
    }
    const correspondingReq = requestor
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === recipient);
    if (correspondingReq !== undefined) {
      console.log(`got corresponding alliance requests, accepting`);
      correspondingReq.accept();
      return null;
    }
    const ar = new AllianceRequestImpl(requestor, recipient, this._ticks, this);
    this.allianceRequests.push(ar);
    this.addUpdate(ar.toUpdate());
    return ar;
  }

  acceptAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );

    const requestor = request.requestor();
    const recipient = request.recipient();

    const existing = requestor.allianceWith(recipient);
    if (existing) {
      throw new Error(
        `cannot accept alliance request, already allied with ${recipient.name()}`,
      );
    }

    // Create and register the new alliance
    const alliance = new AllianceImpl(
      this,
      requestor as PlayerImpl,
      recipient as PlayerImpl,
      this._ticks,
      this.nextAllianceID++,
    );
    this.alliances_.push(alliance);
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );

    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: true,
    });
  }

  rejectAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );
    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: false,
    });
  }

  hasPlayer(id: PlayerID): boolean {
    return this._players.has(id);
  }
  config(): Config {
    return this._config;
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  setPaused(paused: boolean): void {
    this._isPaused = paused;
    this.addUpdate({ type: GameUpdateType.GamePaused, paused });
  }

  inSpawnPhase(): boolean {
    return this._ticks <= this.config().numSpawnPhaseTurns();
  }

  ticks(): number {
    return this._ticks;
  }

  executeNextTick(): GameUpdates {
    const _perfTick = perfBegin("tick.total");
    this.updates = createGameUpdatesMap();
    this.tileUpdatePairs.length = 0;
    const _perfExecs = perfBegin("tick.execs");
    if (perfIsEnabled()) {
      // Per-execution-class measurement: only enabled when the perf
      // overlay is open so we don't pay performance.now() per exec in
      // production. Class names are stable identifiers (NukeExecution,
      // BattlecruiserExecution, etc.) so the registry stays bounded.
      this.execs.forEach((e) => {
        if (
          (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) &&
          e.isActive()
        ) {
          const t0 = performance.now();
          e.tick(this._ticks);
          perfRecord(`exec.${e.constructor.name}`, performance.now() - t0);
        }
      });
    } else {
      this.execs.forEach((e) => {
        if (
          (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) &&
          e.isActive()
        ) {
          e.tick(this._ticks);
        }
      });
    }
    perfEnd("tick.execs", _perfExecs);
    const inited: Execution[] = [];
    const unInited: Execution[] = [];
    this.unInitExecs.forEach((e) => {
      if (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) {
        e.init(this, this._ticks);
        inited.push(e);
      } else {
        unInited.push(e);
      }
    });

    const _perfPrune = perfBegin("tick.removeInactive");
    this.removeInactiveExecutions();
    perfEnd("tick.removeInactive", _perfPrune);

    this.execs.push(...inited);
    this.unInitExecs = unInited;
    const _perfPlayerUpdates = perfBegin("tick.playerUpdates");
    for (const player of this._players.values()) {
      // Players change each to so always add them
      this.addUpdate(player.toUpdate());
    }
    perfEnd("tick.playerUpdates", _perfPlayerUpdates);
    if (this.ticks() % 10 === 0) {
      this.addUpdate({
        type: GameUpdateType.Hash,
        tick: this.ticks(),
        hash: this.hash(),
      });
    }
    this._ticks++;
    perfEnd("tick.total", _perfTick);
    return this.updates;
  }

  private recordTileUpdate(tile: TileRef): void {
    this.tileUpdatePairs.push(tile, this._map.tileState(tile));
  }

  drainPackedTileUpdates(): Uint32Array {
    const pairs = this.tileUpdatePairs;
    const packed = new Uint32Array(pairs.length);
    for (let i = 0; i < pairs.length; i++) {
      packed[i] = pairs[i];
    }
    pairs.length = 0;
    return packed;
  }

  recordMotionPlan(record: MotionPlanRecord): void {
    switch (record.kind) {
      case "grid":
        this.planDrivenUnitIds.add(record.unitId);
        break;
      case "frigate":
        this.planDrivenUnitIds.add(record.engineUnitId);
        for (const unitId of record.carUnitIds) {
          this.planDrivenUnitIds.add(unitId);
        }
        break;
    }
    this.motionPlanRecords.push(record);
  }

  private isUnitPlanDriven(unitId: number): boolean {
    return this.planDrivenUnitIds.has(unitId);
  }

  maybeAddUnitUpdate(unit: Unit): void {
    if (!this.isUnitPlanDriven(unit.id())) {
      this.addUpdate(unit.toUpdate());
    }
  }

  onUnitMoved(unit: Unit): void {
    this.updateUnitTile(unit);
    this.maybeAddUnitUpdate(unit);
  }

  drainPackedMotionPlans(): Uint32Array | null {
    const records = this.motionPlanRecords;
    if (records.length === 0) {
      return null;
    }
    const packed = packMotionPlans(records);
    records.length = 0;
    return packed;
  }

  private hash(): number {
    let hash = 1;
    this._players.forEach((p) => {
      hash += p.hash();
    });
    return hash;
  }

  terraNullius(): TerraNullius {
    return this._terraNullius;
  }

  removeInactiveExecutions(): void {
    const activeExecs: Execution[] = [];
    for (const exec of this.execs) {
      if (this.inSpawnPhase()) {
        if (exec.activeDuringSpawnPhase()) {
          if (exec.isActive()) {
            activeExecs.push(exec);
          }
        } else {
          activeExecs.push(exec);
        }
      } else {
        if (exec.isActive()) {
          activeExecs.push(exec);
        }
      }
    }
    this.execs = activeExecs;
  }

  players(): Player[] {
    return Array.from(this._players.values()).filter((p) => p.isAlive());
  }

  allPlayers(): Player[] {
    return Array.from(this._players.values());
  }

  executions(): Execution[] {
    return [...this.execs, ...this.unInitExecs];
  }

  addExecution(...exec: Execution[]) {
    this.unInitExecs.push(...exec);
  }

  removeExecution(exec: Execution) {
    this.execs = this.execs.filter((execution) => execution !== exec);
    this.unInitExecs = this.unInitExecs.filter(
      (execution) => execution !== exec,
    );
  }

  playerView(id: PlayerID): Player {
    return this.player(id);
  }

  addPlayer(playerInfo: PlayerInfo, team: Team | null = null): Player {
    const player = new PlayerImpl(
      this,
      this.nextPlayerID,
      playerInfo,
      this.config().startManpower(playerInfo),
      team ?? this.maybeAssignTeam(playerInfo),
    );
    this._playersBySmallID.push(player);
    this.nextPlayerID++;
    this._players.set(playerInfo.id, player);
    return player;
  }

  private maybeAssignTeam(player: PlayerInfo): Team | null {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return null;
    }
    if (player.playerType === PlayerType.Bot) {
      return this.botTeam;
    }
    const rand = simpleHash(player.id);
    return this.playerTeams[rand % this.playerTeams.length];
  }

  player(id: PlayerID): Player {
    const player = this._players.get(id);
    if (player === undefined) {
      throw new Error(`Player with id ${id} not found`);
    }
    return player;
  }

  playerByClientID(id: ClientID): Player | null {
    for (const [, player] of this._players) {
      if (player.clientID() === id) {
        return player;
      }
    }
    return null;
  }

  isOnMap(cell: Cell): boolean {
    return (
      cell.x >= 0 &&
      cell.x < this._width &&
      cell.y >= 0 &&
      cell.y < this._height
    );
  }

  neighborsWithDiag(tile: TileRef): TileRef[] {
    const x = this.x(tile);
    const y = this.y(tile);
    const ns: TileRef[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip the center tile
        const newX = x + dx;
        const newY = y + dy;
        if (
          newX >= 0 &&
          newX < this._width &&
          newY >= 0 &&
          newY < this._height
        ) {
          ns.push(this._map.ref(newX, newY));
        }
      }
    }
    return ns;
  }

  // Zero-allocation neighbor iteration for performance-critical code
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void {
    const x = this.x(tile);
    const y = this.y(tile);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip the center tile
        const newX = x + dx;
        const newY = y + dy;
        if (
          newX >= 0 &&
          newX < this._width &&
          newY >= 0 &&
          newY < this._height
        ) {
          callback(this._map.ref(newX, newY));
        }
      }
    }
  }

  conquer(owner: PlayerImpl, tile: TileRef): void {
    if (!this.isSector(tile)) {
      throw Error(`cannot conquer water`);
    }
    const previousOwner = this.owner(tile) as TerraNullius | PlayerImpl;
    if (previousOwner.isPlayer()) {
      previousOwner._lastTileChange = this._ticks;
      previousOwner._tiles.delete(tile);
      previousOwner._borderTiles.delete(tile);
      this._sectorMap.recordTileLost(previousOwner.smallID(), tile);
    }
    this._map.setOwnerID(tile, owner.smallID());
    owner._tiles.add(tile);
    owner._lastTileChange = this._ticks;
    this._sectorMap.recordTileGained(owner.smallID(), tile);
    // GDD §10 scoring — book-keep the first time a player owns a tile in
    // each sector. The Stats set is keyed by sector ID, so re-conquests
    // collapse to the same entry. Cheap: O(1) lookup + Set.add().
    const conqueredSectorId = this._sectorMap.sectorOf(tile);
    if (conqueredSectorId > 0) {
      this._stats.recordSectorConquest(owner, conqueredSectorId);
    }
    this.updateBorders(tile);
    this._map.setFallout(tile, false);
    this.recordTileUpdate(tile);
  }

  relinquish(tile: TileRef) {
    if (!this.hasOwner(tile)) {
      throw new Error(`Cannot relinquish tile because it is unowned`);
    }
    if (this.isDeepSpace(tile)) {
      throw new Error("Cannot relinquish water");
    }

    const previousOwner = this.owner(tile) as PlayerImpl;
    previousOwner._lastTileChange = this._ticks;
    previousOwner._tiles.delete(tile);
    previousOwner._borderTiles.delete(tile);
    this._sectorMap.recordTileLost(previousOwner.smallID(), tile);

    this._map.setOwnerID(tile, 0);
    this.updateBorders(tile);
    this.recordTileUpdate(tile);
  }

  private updateBorders(tile: TileRef) {
    const updateBorderStatus = (t: TileRef) => {
      if (!this.hasOwner(t)) {
        return;
      }
      const owner = this.owner(t) as PlayerImpl;
      if (this.calcIsBorder(t)) {
        owner._borderTiles.add(t);
      } else {
        owner._borderTiles.delete(t);
      }
    };

    updateBorderStatus(tile);
    this.forEachNeighbor(tile, updateBorderStatus);
  }

  private calcIsBorder(tile: TileRef): boolean {
    if (!this.hasOwner(tile)) {
      return false;
    }
    const ownerId = this.ownerID(tile);
    const x = this.x(tile);
    const y = this.y(tile);
    if (x > 0 && this.ownerID(this._map.ref(x - 1, y)) !== ownerId) {
      return true;
    }
    if (
      x + 1 < this._width &&
      this.ownerID(this._map.ref(x + 1, y)) !== ownerId
    ) {
      return true;
    }
    if (y > 0 && this.ownerID(this._map.ref(x, y - 1)) !== ownerId) {
      return true;
    }
    if (
      y + 1 < this._height &&
      this.ownerID(this._map.ref(x, y + 1)) !== ownerId
    ) {
      return true;
    }
    return false;
  }

  target(targeter: Player, target: Player) {
    this.addUpdate({
      type: GameUpdateType.TargetPlayer,
      playerID: targeter.smallID(),
      targetID: target.smallID(),
    });
  }

  public breakAlliance(breaker: Player, alliance: MutableAlliance) {
    let other: Player;
    if (alliance.requestor() === breaker) {
      other = alliance.recipient();
    } else {
      other = alliance.requestor();
    }
    if (!breaker.isAlliedWith(other)) {
      throw new Error(
        `${breaker} not allied with ${other}, cannot break alliance`,
      );
    }
    if (!other.isTraitor() && !other.isDisconnected()) {
      breaker.markTraitor();
    }

    this.alliances_ = this.alliances_.filter((a) => a !== alliance);

    this.addUpdate({
      type: GameUpdateType.BrokeAlliance,
      traitorID: breaker.smallID(),
      betrayedID: other.smallID(),
      allianceID: alliance.id(),
    });
  }

  public expireAlliance(alliance: Alliance) {
    const p1Set = new Set(alliance.recipient().alliances());
    const alliances = alliance
      .requestor()
      .alliances()
      .filter((a) => p1Set.has(a));
    if (alliances.length !== 1) {
      throw new Error(
        `cannot expire alliance: must have exactly one alliance, have ${alliances.length}`,
      );
    }
    this.alliances_ = this.alliances_.filter((a) => a !== alliances[0]);
    this.addUpdate({
      type: GameUpdateType.AllianceExpired,
      player1ID: alliance.requestor().smallID(),
      player2ID: alliance.recipient().smallID(),
    });
  }

  public removeAlliancesByPlayerSilently(player: Player): void {
    this.alliances_ = this.alliances_.filter(
      (a) => a.requestor() !== player && a.recipient() !== player,
    );
  }

  public isSpawnImmunityActive(): boolean {
    return (
      this.config().numSpawnPhaseTurns() +
        this.config().spawnImmunityDuration() >
      this.ticks()
    );
  }

  public isNationSpawnImmunityActive(): boolean {
    return (
      this.config().numSpawnPhaseTurns() +
        this.config().nationSpawnImmunityDuration() >
      this.ticks()
    );
  }

  sendEmojiUpdate(msg: EmojiMessage): void {
    this.addUpdate({
      type: GameUpdateType.Emoji,
      emoji: msg,
    });
  }

  setWinner(winner: Player | Team, allPlayersStats: AllPlayersStats): void {
    this._winner = winner;
    this.addUpdate({
      type: GameUpdateType.Win,
      winner: this.makeWinner(winner),
      allPlayersStats,
      runScore: this.runScore() ?? undefined,
    });
  }

  getWinner(): Player | Team | null {
    return this._winner;
  }

  runScore(): RunScore | null {
    return this._stats.runScore(
      this.players(),
      this._ticks,
      this._config.winCondition(),
    );
  }

  canPlayerRejoin(player: Player): boolean {
    if (!this._config.permadeath()) return true;
    // GDD §12 — once a faction has been eliminated in a permadeath run, they
    // cannot rejoin. We treat both "currently dead" and "previously
    // recorded as killed by Stats" as eliminated, since `isAlive()` flickers
    // back to true if PlayerExecution stops running before stats fire.
    if (!player.isAlive()) return false;
    const killedAt = this._stats.getPlayerStats(player)?.killedAt;
    if (killedAt !== undefined && killedAt !== null) return false;
    return true;
  }

  private makeWinner(winner: string | Player): Winner | undefined {
    if (typeof winner === "string") {
      return [
        "team",
        winner,
        ...this.players()
          .filter((p) => p.team() === winner && p.clientID() !== null)
          .map((p) => p.clientID()!),
      ];
    } else {
      const clientId = winner.clientID();
      if (clientId === null) {
        return ["nation", winner.name()];
      }
      return [
        "player",
        clientId,
        // TODO: Assists (vote for peace)
      ];
    }
  }

  teams(): Team[] {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return [];
    }
    return [this.botTeam, ...this.playerTeams];
  }

  teamSpawnArea(team: Team): SpawnArea | undefined {
    if (!this._teamGameSpawnAreas) {
      return undefined;
    }
    const numTeams = this.playerTeams.length;
    const areas = this._teamGameSpawnAreas[String(numTeams)];
    if (!areas) {
      return undefined;
    }
    const teamIndex = this.playerTeams.indexOf(team);
    if (teamIndex < 0 || teamIndex >= areas.length) {
      return undefined;
    }
    return areas[teamIndex];
  }

  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    creditAmount?: bigint,
    params?: Record<string, string | number>,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    this.addUpdate({
      type: GameUpdateType.DisplayEvent,
      messageType: type,
      message: message,
      playerID: id,
      creditAmount: creditAmount,
      params: params,
    });
  }

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    this.addUpdate({
      type: GameUpdateType.DisplayChatEvent,
      key: message,
      category: category,
      target: target,
      playerID: id,
      isFrom,
      recipient: recipient,
    });
  }

  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID,
  ): void {
    const id = this.player(playerID).smallID();

    this.addUpdate({
      type: GameUpdateType.UnitIncoming,
      unitID: unitID,
      message: message,
      messageType: type,
      playerID: id,
    });
  }

  addUnit(u: Unit) {
    this.unitGrid.addUnit(u);
  }
  removeUnit(u: Unit) {
    this.unitGrid.removeUnit(u);
    this.planDrivenUnitIds.delete(u.id());
    if (u.hasTradeHub()) {
      this._hyperspaceLaneNetwork.removeStation(u);
    }
  }
  updateUnitTile(u: Unit) {
    this.unitGrid.updateUnitCell(u);
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ) {
    return this.unitGrid.hasUnitNearby(
      tile,
      searchRange,
      type,
      playerId,
      includeUnderConstruction,
    );
  }

  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean {
    return this.unitGrid.anyUnitNearby(
      tile,
      searchRange,
      types,
      predicate,
      playerId,
      includeUnderConstruction,
    );
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
      includeUnderConstruction,
    ) as Array<{
      unit: Unit;
      distSquared: number;
    }>;
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numSectorTiles(): number {
    return this._map.numSectorTiles();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isSector(ref: TileRef): boolean {
    return this._map.isSector(ref);
  }
  isVoidShore(ref: TileRef): boolean {
    return this._map.isVoidShore(ref);
  }
  isVoid(ref: TileRef): boolean {
    return this._map.isVoid(ref);
  }
  isSectorBoundary(ref: TileRef): boolean {
    return this._map.isSectorBoundary(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  // Zero-allocation neighbor iteration (cardinal only)
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void {
    const x = this.x(tile);
    const y = this.y(tile);
    if (x > 0) callback(this._map.ref(x - 1, y));
    if (x + 1 < this._width) callback(this._map.ref(x + 1, y));
    if (y > 0) callback(this._map.ref(x, y - 1));
    if (y + 1 < this._height) callback(this._map.ref(x, y + 1));
  }
  isDeepSpace(ref: TileRef): boolean {
    return this._map.isDeepSpace(ref);
  }
  isDebrisField(ref: TileRef): boolean {
    return this._map.isDebrisField(ref);
  }
  isSectorEdge(ref: TileRef): boolean {
    return this._map.isSectorEdge(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  setTerrainType(ref: TileRef, type: TerrainType): void {
    this._map.setTerrainType(ref, type);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    return this._map.circleSearch(tile, radius, filter);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  tileState(tile: TileRef): number {
    return this._map.tileState(tile);
  }
  updateTile(tile: TileRef, state: number): void {
    this._map.updateTile(tile, state);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  stats(): Stats {
    return this._stats;
  }
  hyperspaceLaneNetwork(): HyperspaceLaneNetwork {
    return this._hyperspaceLaneNetwork;
  }
  miniDeepSpaceHPA(): PathFinder<number> | null {
    return this._miniDeepSpaceHPA;
  }
  miniDeepSpaceGraph(): AbstractGraph | null {
    return this._miniDeepSpaceGraph;
  }
  getDeepSpaceComponent(tile: TileRef): number | null {
    // Permissive fallback for tests with disableNavMesh
    if (!this._miniDeepSpaceGraph) return 0;

    const miniX = Math.floor(this._map.x(tile) / 2);
    const miniY = Math.floor(this._map.y(tile) / 2);
    const miniTile = this.miniGameMap.ref(miniX, miniY);

    if (this.miniGameMap.isDeepSpace(miniTile)) {
      return this._miniDeepSpaceGraph.getComponentId(miniTile);
    }

    // Shore tile: find water neighbor (expand search for minimap resolution loss)
    for (const n of this.miniGameMap.neighbors(miniTile)) {
      if (this.miniGameMap.isDeepSpace(n)) {
        return this._miniDeepSpaceGraph.getComponentId(n);
      }
    }

    // Extended search: check 2-hop neighbors for narrow straits
    for (const n of this.miniGameMap.neighbors(miniTile)) {
      for (const n2 of this.miniGameMap.neighbors(n)) {
        if (this.miniGameMap.isDeepSpace(n2)) {
          return this._miniDeepSpaceGraph.getComponentId(n2);
        }
      }
    }
    return null;
  }
  hasDeepSpaceComponent(tile: TileRef, component: number): boolean {
    // Permissive fallback for tests with disableNavMesh
    if (!this._miniDeepSpaceGraph) return true;

    const miniX = Math.floor(this._map.x(tile) / 2);
    const miniY = Math.floor(this._map.y(tile) / 2);
    const miniTile = this.miniGameMap.ref(miniX, miniY);

    // Check miniTile itself (shore in full map may be water in minimap)
    if (
      this.miniGameMap.isDeepSpace(miniTile) &&
      this._miniDeepSpaceGraph.getComponentId(miniTile) === component
    ) {
      return true;
    }

    // Check neighbors
    for (const n of this.miniGameMap.neighbors(miniTile)) {
      if (
        this.miniGameMap.isDeepSpace(n) &&
        this._miniDeepSpaceGraph.getComponentId(n) === component
      ) {
        return true;
      }
    }

    // Extended search: check 2-hop neighbors for narrow straits
    for (const n of this.miniGameMap.neighbors(miniTile)) {
      for (const n2 of this.miniGameMap.neighbors(n)) {
        if (
          this.miniGameMap.isDeepSpace(n2) &&
          this._miniDeepSpaceGraph.getComponentId(n2) === component
        ) {
          return true;
        }
      }
    }
    return false;
  }
  conquerPlayer(conqueror: Player, conquered: Player) {
    if (conquered.isDisconnected() && conqueror.isOnSameTeam(conquered)) {
      const ships = conquered
        .units()
        .filter(
          (u) =>
            u.type() === UnitType.Battlecruiser ||
            u.type() === UnitType.AssaultShuttle,
        );

      for (const ship of ships) {
        conqueror.captureUnit(ship);
      }
    }

    // Don't transfer credits when the conquered player didn't play (never attacked anyone)
    // This is especially important when starting credits is enabled
    const stats = this._stats.getPlayerStats(conquered);
    const attacksSent = stats?.attacks?.[ATTACK_INDEX_SENT] ?? 0n;
    const skipCreditTransfer =
      attacksSent === 0n && conquered.type() === PlayerType.Human;
    const creditAmount = skipCreditTransfer ? 0n : conquered.credits();

    if (skipCreditTransfer) {
      this.displayMessage(
        "events_display.conquered_no_credits",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        undefined,
        {
          name: conquered.displayName(),
        },
      );
    } else {
      this.displayMessage(
        "events_display.received_credits_from_conquest",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        creditAmount,
        {
          credits: renderNumber(creditAmount),
          name: conquered.displayName(),
        },
      );
      conqueror.addCredits(creditAmount);
      conquered.removeCredits(creditAmount);

      // Record stats
      this.stats().creditsWar(conqueror, conquered, creditAmount);
    }

    this.addUpdate({
      type: GameUpdateType.ConquestEvent,
      conquerorId: conqueror.id(),
      conqueredId: conquered.id(),
      credits: creditAmount,
    });
  }
}

// Or a more dynamic approach that will catch new enum values:
const createGameUpdatesMap = (): GameUpdates => {
  const map = {} as GameUpdates;
  Object.values(GameUpdateType)
    .filter((key) => !isNaN(Number(key))) // Filter out reverse mappings
    .forEach((key) => {
      map[key as GameUpdateType] = [];
    });
  return map;
};
