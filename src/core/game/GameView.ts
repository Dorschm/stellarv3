import { Colord, colord } from "colord";
import { base64url } from "jose";
import { Config } from "../configuration/Config";
import { ColorPalette } from "../CosmeticSchemas";
import { PatternDecoder } from "../PatternDecoder";
import { ClientID, GameID, Player, PlayerCosmetics } from "../Schemas";
import { createRandomName, formatPlayerDisplayName } from "../Util";
import { WorkerClient } from "../worker/WorkerClient";
import {
  BuildableUnit,
  Cell,
  Credits,
  EmojiMessage,
  FrigateType,
  GameUpdates,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
  PlayerType,
  Team,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameMap, TileRef } from "./GameMap";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { MotionPlanRecord, unpackMotionPlans } from "./MotionPlans";
import { buildPlanets, Planet } from "./Planet";
import { SectorMap } from "./SectorMap";
import { Nation, TerrainMapData } from "./TerrainMapLoader";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "./UnitGrid";
import { UserSettings } from "./UserSettings";

const userSettings: UserSettings = new UserSettings();

/** Shared TerraNullius instance returned for every unowned tile query. */
const TERRA_NULLIUS_SINGLETON = new TerraNulliusImpl();

/**
 * Structural type for the optional `setSectorMap` hook on `DefaultConfig`.
 * Mirrors the server-side hook used in `GameImpl` — keeps the configuration
 * layer decoupled from this view class while still letting the HUD economy
 * formulas read from the same SectorMap the client reconstructs.
 */
interface DefaultConfigLike {
  setSectorMap(sm: SectorMap): void;
}

const FRIENDLY_TINT_TARGET = { r: 0, g: 255, b: 0, a: 1 };
const EMBARGO_TINT_TARGET = { r: 255, g: 0, b: 0, a: 1 };
const BORDER_TINT_RATIO = 0.35;

export class UnitView {
  public _wasUpdated = true;
  public lastPos: TileRef[] = [];
  private _createdAt: Tick;

  constructor(
    private gameView: GameView,
    private data: UnitUpdate,
  ) {
    this.lastPos.push(data.pos);
    this._createdAt = this.gameView.ticks();
  }

  createdAt(): Tick {
    return this._createdAt;
  }

  wasUpdated(): boolean {
    return this._wasUpdated;
  }

  lastTiles(): TileRef[] {
    return this.lastPos;
  }

  lastTile(): TileRef {
    if (this.lastPos.length === 0) {
      return this.data.pos;
    }
    return this.lastPos[0];
  }

  update(data: UnitUpdate) {
    this.lastPos.push(data.pos);
    this._wasUpdated = true;
    this.data = data;
  }

  applyDerivedPosition(pos: TileRef) {
    const prev = this.data.pos;
    this.lastPos.push(pos);
    this._wasUpdated = true;
    this.data = {
      ...this.data,
      lastPos: prev,
      pos,
    };
  }

  id(): number {
    return this.data.id;
  }

  targetable(): boolean {
    return this.data.targetable;
  }

  markedForDeletion(): number | false {
    return this.data.markedForDeletion;
  }

  type(): UnitType {
    return this.data.unitType;
  }
  population(): number {
    return this.data.population;
  }
  retreating(): boolean {
    if (this.type() !== UnitType.AssaultShuttle) {
      throw Error("Must be a transport ship");
    }
    return this.data.retreating;
  }
  tile(): TileRef {
    return this.data.pos;
  }
  owner(): PlayerView {
    return this.gameView.playerBySmallID(this.data.ownerID)! as PlayerView;
  }
  isActive(): boolean {
    return this.data.isActive;
  }
  reachedTarget(): boolean {
    return this.data.reachedTarget;
  }
  hasHealth(): boolean {
    return this.data.health !== undefined;
  }
  health(): number {
    return this.data.health ?? 0;
  }
  isUnderConstruction(): boolean {
    return this.data.underConstruction === true;
  }
  targetUnitId(): number | undefined {
    return this.data.targetUnitId;
  }
  targetTile(): TileRef | undefined {
    return this.data.targetTile;
  }

  // How "ready" this unit is from 0 to 1.
  missileReadinesss(): number {
    const maxMissiles = this.data.level;
    const missilesReloading = this.data.missileTimerQueue.length;

    if (missilesReloading === 0) {
      return 1;
    }

    const missilesReady = maxMissiles - missilesReloading;

    if (missilesReady === 0 && maxMissiles > 1) {
      // Unless we have just one missile (level 1),
      // show 0% readiness so user knows no missiles are ready.
      return 0;
    }

    let readiness = missilesReady / maxMissiles;

    const cooldownDuration =
      this.data.unitType === UnitType.PointDefenseArray
        ? this.gameView.config().pointDefenseCooldown()
        : this.gameView.config().orbitalStrikeCooldown();

    for (const cooldown of this.data.missileTimerQueue) {
      const cooldownProgress = this.gameView.ticks() - cooldown;
      const cooldownRatio = cooldownProgress / cooldownDuration;
      const adjusted = cooldownRatio / maxMissiles;
      readiness += adjusted;
    }
    return readiness;
  }

  level(): number {
    return this.data.level;
  }
  hasTradeHub(): boolean {
    return this.data.hasTradeHub;
  }
  frigateType(): FrigateType | undefined {
    return this.data.frigateType;
  }
  isLoaded(): boolean | undefined {
    return this.data.loaded;
  }
}

export class PlayerView {
  public anonymousName: string | null = null;
  private decoder?: PatternDecoder;

  private _territoryColor: Colord;
  private _borderColor: Colord;
  // Update here to include structure light and dark colors
  private _structureColors: { light: Colord; dark: Colord };

  // Pre-computed border color variants
  private _borderColorNeutral: Colord;
  private _borderColorFriendly: Colord;
  private _borderColorEmbargo: Colord;
  private _borderColorDefendedNeutral: { light: Colord; dark: Colord };
  private _borderColorDefendedFriendly: { light: Colord; dark: Colord };
  private _borderColorDefendedEmbargo: { light: Colord; dark: Colord };

  constructor(
    private game: GameView,
    public data: PlayerUpdate,
    public nameData: NameViewData,
    public cosmetics: PlayerCosmetics,
  ) {
    if (data.clientID === game.myClientID()) {
      this.anonymousName = this.data.name;
    } else {
      this.anonymousName = createRandomName(
        this.data.name,
        this.data.playerType,
      );
    }

    const defaultTerritoryColor = this.game
      .config()
      .theme()
      .territoryColor(this);
    const defaultBorderColor = this.game
      .config()
      .theme()
      .borderColor(defaultTerritoryColor);

    const pattern = userSettings.territoryPatterns()
      ? this.cosmetics.pattern
      : undefined;
    if (pattern) {
      pattern.colorPalette ??= {
        name: "",
        primaryColor: defaultTerritoryColor.toHex(),
        secondaryColor: defaultBorderColor.toHex(),
      } satisfies ColorPalette;
    }

    if (this.team() === null) {
      this._territoryColor = colord(
        this.cosmetics.color?.color ??
          pattern?.colorPalette?.primaryColor ??
          defaultTerritoryColor.toHex(),
      );
    } else {
      this._territoryColor = defaultTerritoryColor;
    }

    this._structureColors = this.game
      .config()
      .theme()
      .structureColors(this._territoryColor);

    const maybeFocusedBorderColor =
      this.game.myClientID() === this.data.clientID
        ? this.game.config().theme().focusedBorderColor()
        : defaultBorderColor;

    this._borderColor = new Colord(
      pattern?.colorPalette?.secondaryColor ??
        this.cosmetics.color?.color ??
        maybeFocusedBorderColor.toHex(),
    );

    // Pre-compute all border color variants once
    const theme = this.game.config().theme();
    const baseRgb = this._borderColor.toRgb();

    // Neutral is just the base color
    this._borderColorNeutral = this._borderColor;

    // Compute friendly tint
    this._borderColorFriendly = colord({
      r: Math.round(
        baseRgb.r * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.r * BORDER_TINT_RATIO,
      ),
      g: Math.round(
        baseRgb.g * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.g * BORDER_TINT_RATIO,
      ),
      b: Math.round(
        baseRgb.b * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.b * BORDER_TINT_RATIO,
      ),
      a: baseRgb.a,
    });

    // Compute embargo tint
    this._borderColorEmbargo = colord({
      r: Math.round(
        baseRgb.r * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.r * BORDER_TINT_RATIO,
      ),
      g: Math.round(
        baseRgb.g * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.g * BORDER_TINT_RATIO,
      ),
      b: Math.round(
        baseRgb.b * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.b * BORDER_TINT_RATIO,
      ),
      a: baseRgb.a,
    });

    // Pre-compute defended variants
    this._borderColorDefendedNeutral = theme.defendedBorderColors(
      this._borderColorNeutral,
    );
    this._borderColorDefendedFriendly = theme.defendedBorderColors(
      this._borderColorFriendly,
    );
    this._borderColorDefendedEmbargo = theme.defendedBorderColors(
      this._borderColorEmbargo,
    );

    this.decoder =
      pattern === undefined
        ? undefined
        : new PatternDecoder(pattern, base64url.decode);
  }

  territoryColor(tile?: TileRef): Colord {
    if (tile === undefined || this.decoder === undefined) {
      return this._territoryColor;
    }
    const isPrimary = this.decoder.isPrimary(
      this.game.x(tile),
      this.game.y(tile),
    );
    return isPrimary ? this._territoryColor : this._borderColor;
  }

  structureColors(): { light: Colord; dark: Colord } {
    return this._structureColors;
  }

  /**
   * Border color for a tile:
   * - Tints by neighbor relations (embargo → red, friendly → green, else neutral).
   * - If defended, applies theme checkerboard to the tinted color.
   */
  borderColor(tile?: TileRef, isDefended: boolean = false): Colord {
    if (tile === undefined) {
      return this._borderColor;
    }

    const { hasEmbargo, hasFriendly } = this.borderRelationFlags(tile);

    let baseColor: Colord;
    let defendedColors: { light: Colord; dark: Colord };

    if (hasEmbargo) {
      baseColor = this._borderColorEmbargo;
      defendedColors = this._borderColorDefendedEmbargo;
    } else if (hasFriendly) {
      baseColor = this._borderColorFriendly;
      defendedColors = this._borderColorDefendedFriendly;
    } else {
      baseColor = this._borderColorNeutral;
      defendedColors = this._borderColorDefendedNeutral;
    }

    if (!isDefended) {
      return baseColor;
    }

    const x = this.game.x(tile);
    const y = this.game.y(tile);
    const lightTile =
      (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
    return lightTile ? defendedColors.light : defendedColors.dark;
  }

  /**
   * Border relation flags for a tile, used by both CPU and WebGL renderers.
   */
  borderRelationFlags(tile: TileRef): {
    hasEmbargo: boolean;
    hasFriendly: boolean;
  } {
    const mySmallID = this.smallID();
    let hasEmbargo = false;
    let hasFriendly = false;

    for (const n of this.game.neighbors(tile)) {
      if (!this.game.hasOwner(n)) {
        continue;
      }

      const otherOwner = this.game.owner(n);
      if (!otherOwner.isPlayer() || otherOwner.smallID() === mySmallID) {
        continue;
      }

      if (this.hasEmbargo(otherOwner)) {
        hasEmbargo = true;
        break;
      }

      if (this.isFriendly(otherOwner) || otherOwner.isFriendly(this)) {
        hasFriendly = true;
      }
    }
    return { hasEmbargo, hasFriendly };
  }

  async actions(
    tile?: TileRef,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): Promise<PlayerActions> {
    return this.game.worker.playerInteraction(
      this.id(),
      tile && this.game.x(tile),
      tile && this.game.y(tile),
      units,
    );
  }

  async buildables(
    tile?: TileRef,
    units?: readonly PlayerBuildableUnitType[],
  ): Promise<BuildableUnit[]> {
    return this.game.worker.playerBuildables(
      this.id(),
      tile && this.game.x(tile),
      tile && this.game.y(tile),
      units,
    );
  }

  async borderTiles(): Promise<PlayerBorderTiles> {
    return this.game.worker.playerBorderTiles(this.id());
  }

  outgoingAttacks(): AttackUpdate[] {
    return this.data.outgoingAttacks;
  }

  incomingAttacks(): AttackUpdate[] {
    return this.data.incomingAttacks;
  }

  async attackClusteredPositions(
    attackID?: string,
  ): Promise<{ id: string; positions: Cell[] }[]> {
    return this.game.worker.attackClusteredPositions(this.smallID(), attackID);
  }

  units(...types: UnitType[]): UnitView[] {
    return this.game
      .units(...types)
      .filter((u) => u.owner().smallID() === this.smallID());
  }

  nameLocation(): NameViewData {
    return this.nameData;
  }

  smallID(): number {
    return this.data.smallID;
  }

  name(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.data.name;
  }
  displayName(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.data.displayName;
  }

  clientID(): ClientID | null {
    return this.data.clientID;
  }
  id(): PlayerID {
    return this.data.id;
  }
  team(): Team | null {
    return this.data.team ?? null;
  }
  type(): PlayerType {
    return this.data.playerType;
  }
  isAlive(): boolean {
    return this.data.isAlive;
  }
  isPlayer(): this is PlayerView {
    return true;
  }
  numTilesOwned(): number {
    return this.data.tilesOwned;
  }
  allies(): PlayerView[] {
    return this.data.allies.map(
      (a) => this.game.playerBySmallID(a) as PlayerView,
    );
  }
  targets(): PlayerView[] {
    return this.data.targets.map(
      (id) => this.game.playerBySmallID(id) as PlayerView,
    );
  }
  credits(): Credits {
    return this.data.credits;
  }

  population(): number {
    return this.data.population;
  }

  totalUnitLevels(type: UnitType): number {
    return this.units(type)
      .filter((unit) => !unit.isUnderConstruction())
      .map((unit) => unit.level())
      .reduce((a, b) => a + b, 0);
  }

  isMe(): boolean {
    return this.smallID() === this.game.myPlayer()?.smallID();
  }

  isLobbyCreator(): boolean {
    return this.data.isLobbyCreator;
  }

  isAlliedWith(other: PlayerView): boolean {
    return this.data.allies.some((n) => other.smallID() === n);
  }

  isOnSameTeam(other: PlayerView): boolean {
    return this.data.team !== undefined && this.data.team === other.data.team;
  }

  isFriendly(other: PlayerView): boolean {
    return this.isAlliedWith(other) || this.isOnSameTeam(other);
  }

  isRequestingAllianceWith(other: PlayerView) {
    return this.data.outgoingAllianceRequests.some((id) => other.id() === id);
  }

  alliances(): AllianceView[] {
    return this.data.alliances;
  }

  hasEmbargoAgainst(other: PlayerView): boolean {
    return this.data.embargoes.has(other.id());
  }

  hasEmbargo(other: PlayerView): boolean {
    return this.hasEmbargoAgainst(other) || other.hasEmbargoAgainst(this);
  }

  profile(): Promise<PlayerProfile> {
    return this.game.worker.playerProfile(this.smallID());
  }

  bestShuttleSpawn(targetTile: TileRef): Promise<TileRef | false> {
    return this.game.worker.transportShipSpawn(this.id(), targetTile);
  }

  transitiveTargets(): PlayerView[] {
    return [...this.targets(), ...this.allies().flatMap((p) => p.targets())];
  }

  isTraitor(): boolean {
    return this.data.isTraitor;
  }
  getTraitorRemainingTicks(): number {
    return Math.max(0, this.data.traitorRemainingTicks ?? 0);
  }
  outgoingEmojis(): EmojiMessage[] {
    return this.data.outgoingEmojis;
  }

  hasSpawned(): boolean {
    return this.data.hasSpawned;
  }
  isDisconnected(): boolean {
    return this.data.isDisconnected;
  }

  lastDeleteUnitTick(): Tick {
    return this.data.lastDeleteUnitTick;
  }

  deleteUnitCooldown(): number {
    return (
      Math.max(
        0,
        this.game.config().deleteUnitCooldown() -
          (this.game.ticks() + 1 - this.lastDeleteUnitTick()),
      ) / 10
    );
  }
}

type FrigatePlanState = {
  planId: number;
  startTick: number;
  speed: number;
  spacing: number;
  carUnitIds: Uint32Array;
  path: Uint32Array;
  cursor: number;
  usedTilesBuf: Uint32Array;
  usedHead: number;
  usedLen: number;
  lastAdvancedTick: Tick;
};

export class GameView implements GameMap {
  private lastUpdate: GameUpdateViewData | null;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  private updatedTiles: TileRef[] = [];

  private _myPlayer: PlayerView | null = null;

  private unitGrid: UnitGrid;
  private unitMotionPlans = new Map<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  >();
  private frigateMotionPlans = new Map<number, FrigatePlanState>();
  private trainUnitToEngine = new Map<number, number>();

  private toDelete = new Set<number>();

  private _cosmetics: Map<string, PlayerCosmetics> = new Map();

  private _map: GameMap;
  private _sectorMap: SectorMap;

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _mapData: TerrainMapData,
    private _myClientID: ClientID | undefined,
    private _myUsername: string,
    private _myClanTag: string | null,
    private _gameID: GameID,
    humans: Player[],
  ) {
    this._map = this._mapData.gameMap;
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid(this._map);
    // Reconstruct the SectorMap client-side from the same map binary +
    // manifest nations the server uses. This produces an identical sector
    // partitioning without shipping any extra payload over the wire.
    this._sectorMap = new SectorMap(
      this._map,
      this._mapData.nations.map((n) => ({
        x: n.coordinates[0],
        y: n.coordinates[1],
      })),
    );
    // Wire the client-side SectorMap into the shared `DefaultConfig` the
    // HUD consults for population/max/credit rates. Without this the HUD would
    // keep reading `_sectorMap === null` and fall back to the pre-economy
    // formulas, diverging from the authoritative server tick once any
    // sector/habitability effects are active. Mirrors the server-side
    // pattern in `GameImpl` — same structural check so tests using a
    // bare config stub still pass through untouched.
    const maybeDefaultConfig = this
      ._config as unknown as Partial<DefaultConfigLike>;
    if (typeof maybeDefaultConfig.setSectorMap === "function") {
      maybeDefaultConfig.setSectorMap(this._sectorMap);
    }
    this._cosmetics = new Map(
      humans.map((h) => [h.clientID, h.cosmetics ?? {}]),
    );
    for (const nation of this._mapData.nations) {
      // Nations don't have client ids, so we use their name as the key instead.
      this._cosmetics.set(nation.name, {
        flag: nation.flag ? `/flags/${nation.flag}.svg` : undefined,
      } satisfies PlayerCosmetics);
    }
  }

  sectorMap(): SectorMap {
    return this._sectorMap;
  }

  /**
   * GDD §2 — client-side mirror of {@link Game.planets}. Built lazily
   * from the same `SectorMap` + manifest-nation pair the server uses,
   * so both sides resolve the same `id`/`sectorId`/`name` values
   * without any network traffic. Cached on first access for stable
   * object identity (HUD components store references by index).
   */
  private _planets: readonly Planet[] | null = null;
  planets(): readonly Planet[] {
    this._planets ??= buildPlanets(
      this._sectorMap,
      this._map,
      this._mapData.nations.map((n) => ({
        name: n.name,
        coordinates: [n.coordinates[0], n.coordinates[1]] as const,
      })),
    );
    return this._planets;
  }

  planetByTile(tile: TileRef): Planet | null {
    const sectorId = this._sectorMap.sectorOf(tile);
    if (sectorId === 0) return null;
    const list = this.planets();
    for (const p of list) {
      if (p.sectorId === sectorId) return p;
    }
    return null;
  }

  // Scout Swarm terraform progress is tracked server-side only. On the
  // client (`GameView`) the methods are stubs so any read-only rendering
  // or HUD hover can still call them without blowing up — the authoritative
  // game tick runs on the worker.
  recordScoutSwarmTerraformProgress(_tile: TileRef): number {
    return 0;
  }

  resetScoutSwarmTerraformProgress(_tile: TileRef): void {
    // no-op on the view side
  }

  scoutSwarmTerraformProgress(_tile: TileRef): number {
    return 0;
  }

  // LRW intercept registry is server-authoritative; on the client these
  // are inert stubs so any read-only path that touches Game still type-
  // checks. Tokens issued here are throwaway and never collide with the
  // server registry — the client never schedules its own LRW impacts.
  registerPendingLrwImpact(
    _ownerSmallID: number,
    _fireTile: TileRef,
    _targetTile: TileRef,
    _impactTick: number,
  ): number {
    return 0;
  }

  unregisterPendingLrwImpact(_token: number): void {
    // no-op on the view side
  }

  isPendingLrwImpactActive(_token: number): boolean {
    return false;
  }

  pendingLrwImpactsNear(
    _tile: TileRef,
    _range: number,
    _excludeOwnerSmallID?: number,
  ): Array<{
    token: number;
    targetTile: TileRef;
    ownerSmallID: number;
    distSquared: number;
  }> {
    return [];
  }

  interceptPendingLrwImpact(_token: number): boolean {
    return false;
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates | null {
    return this.lastUpdate?.updates ?? null;
  }

  public motionPlans(): ReadonlyMap<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  > {
    return this.unitMotionPlans;
  }

  private motionPlannedUnitIdsCache: number[] = [];
  private motionPlannedUnitIdsDirty = true;

  private markMotionPlannedUnitIdsDirty(): void {
    this.motionPlannedUnitIdsDirty = true;
  }

  private rebuildMotionPlannedUnitIdsCacheIfDirty(): void {
    if (!this.motionPlannedUnitIdsDirty) {
      return;
    }
    this.motionPlannedUnitIdsDirty = false;

    const out = this.motionPlannedUnitIdsCache;
    out.length = 0;

    for (const unitId of this.unitMotionPlans.keys()) {
      out.push(unitId);
    }
    for (const [engineId, plan] of this.frigateMotionPlans) {
      out.push(engineId);
      for (let i = 0; i < plan.carUnitIds.length; i++) {
        const id = plan.carUnitIds[i] >>> 0;
        if (id !== 0) out.push(id);
      }
    }
  }

  public motionPlannedUnitIds(): number[] {
    this.rebuildMotionPlannedUnitIdsCacheIfDirty();
    return this.motionPlannedUnitIdsCache;
  }

  public isCatchingUp(): boolean {
    return (this.lastUpdate?.pendingTurns ?? 0) > 1;
  }

  public update(gu: GameUpdateViewData) {
    this.toDelete.forEach((id) => this._units.delete(id));
    this.toDelete.clear();

    this.lastUpdate = gu;

    this.updatedTiles = [];
    const packed = this.lastUpdate.packedTileUpdates;
    for (let i = 0; i + 1 < packed.length; i += 2) {
      const tile = packed[i];
      const state = packed[i + 1];
      // updateTile() handles SectorMap owner-transition bookkeeping
      // internally — see its body. GameImpl drives these counters on the
      // server via conquer/relinquish; on the client, packed tile updates
      // are the only ownership signal, so we funnel them through the same
      // updateTile hook to keep HUD consumers (ControlPanel, Leaderboard)
      // in sync with the authoritative server habitability formulas.
      this.updateTile(tile, state);
      this.updatedTiles.push(tile);
    }

    // Ticket 6 — apply terrain mutations streamed from the server for this
    // tick. These are rare (Scout Swarm terraforming), so the buffer is
    // usually empty. Each pair is `[tileRef, terrainType]`. We funnel the
    // mutation through `setTerrainType` (which knows how to rewrite the
    // underlying magnitude bits) and then re-run the habitability delta so
    // derived UI (habitability overlay, HUD income rates) stays coherent
    // with the server-side SectorMap counters.
    const terrainPacked = this.lastUpdate.packedTerrainUpdates;
    if (terrainPacked && terrainPacked.length > 0) {
      for (let i = 0; i + 1 < terrainPacked.length; i += 2) {
        const tile = terrainPacked[i];
        const nextTerrain = terrainPacked[i + 1] as TerrainType;
        this.setTerrainType(tile, nextTerrain);
        this.updatedTiles.push(tile);
      }
    }

    if (gu.packedMotionPlans) {
      const records = unpackMotionPlans(gu.packedMotionPlans);
      this.applyMotionPlanRecords(records);
    }

    if (gu.updates === null) {
      throw new Error("lastUpdate.updates not initialized");
    }
    const myDisplayName = formatPlayerDisplayName(
      this._myUsername,
      this._myClanTag,
    );

    gu.updates[GameUpdateType.Player].forEach((pu) => {
      // Replace the local player's name/displayName with their own stored values.
      // This way the user does not know they are being censored.
      if (pu.clientID === this._myClientID) {
        pu.name = this._myUsername;
        pu.displayName = myDisplayName;
      }

      this.smallIDToID.set(pu.smallID, pu.id);
      let player = this._players.get(pu.id);
      if (player !== undefined) {
        player.data = pu;
        const nextNameData = gu.playerNameViewData[pu.id];
        if (nextNameData !== undefined) {
          player.nameData = nextNameData;
        }
      } else {
        player = new PlayerView(
          this,
          pu,
          gu.playerNameViewData[pu.id],
          // First check human by clientID, then check nation by name.
          this._cosmetics.get(pu.clientID ?? "") ??
            this._cosmetics.get(pu.name) ??
            {},
        );
        this._players.set(pu.id, player);
      }
    });

    if (this._myClientID) {
      this._myPlayer ??= this.playerByClientID(this._myClientID);
    }

    for (const unit of this._units.values()) {
      unit._wasUpdated = false;
      unit.lastPos = unit.lastPos.slice(-1);
    }
    gu.updates[GameUpdateType.Unit].forEach((update) => {
      let unit = this._units.get(update.id);
      if (unit !== undefined) {
        unit.update(update);
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
        this.unitGrid.addUnit(unit);
      }
      if (!update.isActive) {
        this.unitGrid.removeUnit(unit);
      } else if (unit.tile() !== unit.lastTile()) {
        this.unitGrid.updateUnitCell(unit);
      }
      if (!unit.isActive()) {
        // Wait until next tick to delete the unit.
        this.toDelete.add(unit.id());
        if (this.unitMotionPlans.delete(unit.id())) {
          this.markMotionPlannedUnitIdsDirty();
        }
        this.clearFrigatePlanForUnit(unit.id());
      }
    });

    this.advanceMotionPlannedUnits(gu.tick);
    this.rebuildMotionPlannedUnitIdsCacheIfDirty();
  }

  private advanceMotionPlannedUnits(currentTick: Tick): void {
    for (const [unitId, plan] of this.unitMotionPlans) {
      const unit = this._units.get(unitId);
      if (!unit || !unit.isActive()) {
        if (this.unitMotionPlans.delete(unitId)) {
          this.markMotionPlannedUnitIdsDirty();
        }
        continue;
      }

      const oldTile = unit.tile();
      const dt = currentTick - plan.startTick;
      const stepIndex =
        dt <= 0 ? 0 : Math.floor(dt / Math.max(1, plan.ticksPerStep));
      const lastIndex = plan.path.length - 1;
      const idx = Math.max(0, Math.min(lastIndex, stepIndex));
      const newTile = plan.path[idx] as TileRef;

      if (newTile !== oldTile) {
        unit.applyDerivedPosition(newTile);
        this.unitGrid.updateUnitCell(unit);
        continue;
      }

      // Once a plan is past its final step, `newTile` remains clamped to the last path tile.
      // Drop finished plans to avoid repeatedly marking static units as updated each tick.
      if (dt > 0 && stepIndex >= lastIndex) {
        if (this.unitMotionPlans.delete(unitId)) {
          this.markMotionPlannedUnitIdsDirty();
        }
      }
    }

    this.advanceTrainMotionPlannedUnits(currentTick);
  }

  private clearFrigatePlanForUnit(unitId: number): void {
    const engineId =
      this.trainUnitToEngine.get(unitId) ??
      (this.frigateMotionPlans.has(unitId) ? unitId : null);
    if (engineId === null) {
      return;
    }
    const plan = this.frigateMotionPlans.get(engineId);
    if (!plan) {
      this.trainUnitToEngine.delete(unitId);
      return;
    }
    if (this.frigateMotionPlans.delete(engineId)) {
      this.markMotionPlannedUnitIdsDirty();
    }
    this.trainUnitToEngine.delete(engineId);
    for (let i = 0; i < plan.carUnitIds.length; i++) {
      const id = plan.carUnitIds[i] >>> 0;
      if (id !== 0) this.trainUnitToEngine.delete(id);
    }
  }

  private advanceTrainMotionPlannedUnits(currentTick: Tick): void {
    const staleEngineIds: number[] = [];
    for (const [engineId, plan] of this.frigateMotionPlans) {
      const engine = this._units.get(engineId);
      if (!engine || !engine.isActive()) {
        staleEngineIds.push(engineId);
        continue;
      }

      const steps = currentTick - plan.lastAdvancedTick;
      if (steps <= 0) {
        continue;
      }

      const path = plan.path;
      const lastIndex = path.length - 1;
      const cap = plan.usedTilesBuf.length;

      const pushUsed = (tile: TileRef) => {
        if (cap === 0) return;
        if (plan.usedLen < cap) {
          const idx = (plan.usedHead + plan.usedLen) % cap;
          plan.usedTilesBuf[idx] = tile >>> 0;
          plan.usedLen++;
        } else {
          plan.usedTilesBuf[plan.usedHead] = tile >>> 0;
          plan.usedHead = (plan.usedHead + 1) % cap;
          plan.usedLen = cap;
        }
      };

      const usedGet = (index: number): TileRef | null => {
        if (index < 0 || index >= plan.usedLen || cap === 0) return null;
        const idx = (plan.usedHead + index) % cap;
        return plan.usedTilesBuf[idx] as TileRef;
      };

      let didMove = false;
      for (let step = 0; step < steps; step++) {
        const cursor = plan.cursor;
        if (cursor >= lastIndex) {
          break;
        }
        for (let i = 0; i < plan.speed && cursor + i < path.length; i++) {
          pushUsed(path[cursor + i] as TileRef);
        }

        plan.cursor = Math.min(lastIndex, cursor + plan.speed);

        for (let i = plan.carUnitIds.length - 1; i >= 0; --i) {
          const carId = plan.carUnitIds[i] >>> 0;
          if (carId === 0) continue;
          const car = this._units.get(carId);
          if (!car || !car.isActive()) {
            continue;
          }
          const carTileIndex = (i + 1) * plan.spacing + 2;
          const tile = usedGet(carTileIndex);
          if (tile !== null) {
            const oldTile = car.tile();
            if (tile !== oldTile) {
              car.applyDerivedPosition(tile);
              this.unitGrid.updateUnitCell(car);
              didMove = true;
            }
          }
        }

        const newEngineTile = path[plan.cursor] as TileRef;
        const oldEngineTile = engine.tile();
        if (newEngineTile !== oldEngineTile) {
          engine.applyDerivedPosition(newEngineTile);
          this.unitGrid.updateUnitCell(engine);
          didMove = true;
        }
      }

      plan.lastAdvancedTick = currentTick;

      // Preserve the final-step redraw (plan remains for the tick where motion ends),
      // then clear once the frigate has settled and no longer moves.
      // Note: trains are currently deleted at the end of FrigateExecution, and the ensuing
      // `Unit` update (isActive=false) also clears any associated motion plan records.
      // This expiry is defensive to avoid keeping stale plans around if that behavior changes.
      if (!didMove && plan.cursor >= lastIndex) {
        staleEngineIds.push(engineId);
      }
    }

    for (const engineId of staleEngineIds) {
      this.clearFrigatePlanForUnit(engineId);
    }
  }

  private applyMotionPlanRecords(records: readonly MotionPlanRecord[]): void {
    for (const record of records) {
      switch (record.kind) {
        case "grid": {
          if (record.ticksPerStep < 1 || record.path.length < 1) {
            break;
          }
          const existing = this.unitMotionPlans.get(record.unitId);
          if (existing && record.planId <= existing.planId) {
            break;
          }

          const path =
            record.path instanceof Uint32Array
              ? record.path
              : Uint32Array.from(record.path);

          this.unitMotionPlans.set(record.unitId, {
            planId: record.planId,
            startTick: record.startTick,
            ticksPerStep: record.ticksPerStep,
            path,
          });
          this.markMotionPlannedUnitIdsDirty();
          break;
        }
        case "frigate": {
          if (record.speed < 1 || record.path.length < 1) {
            break;
          }
          const existing = this.frigateMotionPlans.get(record.engineUnitId);
          if (existing && record.planId <= existing.planId) {
            break;
          }
          if (existing) {
            this.clearFrigatePlanForUnit(record.engineUnitId);
          }

          const carUnitIds =
            record.carUnitIds instanceof Uint32Array
              ? record.carUnitIds
              : Uint32Array.from(record.carUnitIds);
          const path =
            record.path instanceof Uint32Array
              ? record.path
              : Uint32Array.from(record.path);

          const usedCap = carUnitIds.length * record.spacing + 3;
          const usedTilesBuf = new Uint32Array(Math.max(0, usedCap));

          this.frigateMotionPlans.set(record.engineUnitId, {
            planId: record.planId,
            startTick: record.startTick,
            speed: record.speed,
            spacing: record.spacing,
            carUnitIds,
            path,
            cursor: 0,
            usedTilesBuf,
            usedHead: 0,
            usedLen: 0,
            lastAdvancedTick: record.startTick,
          });
          this.markMotionPlannedUnitIdsDirty();

          this.trainUnitToEngine.set(record.engineUnitId, record.engineUnitId);
          for (let i = 0; i < carUnitIds.length; i++) {
            const carId = carUnitIds[i] >>> 0;
            if (carId !== 0)
              this.trainUnitToEngine.set(carId, record.engineUnitId);
          }
          break;
        }
      }
    }
  }

  recentlyUpdatedTiles(): TileRef[] {
    return this.updatedTiles;
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
    ) as Array<{
      unit: UnitView;
      distSquared: number;
    }>;
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
    predicate: (unit: UnitView) => boolean,
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

  myClientID(): ClientID | undefined {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    return this._myPlayer;
  }

  player(id: PlayerID): PlayerView {
    const player = this._players.get(id);
    if (player === undefined) {
      throw Error(`player id ${id} not found`);
    }
    return player;
  }

  players(): PlayerView[] {
    return Array.from(this._players.values());
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id === 0) {
      // Singleton — avoids ~500k allocations during the initial SpaceMapPlane
      // paint pass when nearly every tile is unowned. TerraNulliusImpl is
      // stateless, so sharing one instance is safe.
      return TERRA_NULLIUS_SINGLETON;
    }
    const playerId = this.smallIDToID.get(id);
    if (playerId === undefined) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(playerId);
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter(
        (p) => p.clientID() === id,
      )[0] ?? null;
    if (player === null) {
      return null;
    }
    return player;
  }
  hasPlayer(id: PlayerID): boolean {
    return false;
  }
  playerViews(): PlayerView[] {
    return Array.from(this._players.values());
  }

  owner(tile: TileRef): PlayerView | TerraNullius {
    return this.playerBySmallID(this.ownerID(tile));
  }

  ticks(): Tick {
    if (this.lastUpdate === null) return 0;
    return this.lastUpdate.tick;
  }
  inSpawnPhase(): boolean {
    return this.ticks() <= this._config.numSpawnPhaseTurns();
  }
  isSpawnImmunityActive(): boolean {
    return (
      this._config.numSpawnPhaseTurns() + this._config.spawnImmunityDuration() >
      this.ticks()
    );
  }
  isNationSpawnImmunityActive(): boolean {
    return (
      this._config.numSpawnPhaseTurns() +
        this._config.nationSpawnImmunityDuration() >
      this.ticks()
    );
  }
  config(): Config {
    return this._config;
  }
  units(...types: UnitType[]): UnitView[] {
    if (types.length === 0) {
      return Array.from(this._units.values()).filter((u) => u.isActive());
    }
    return Array.from(this._units.values()).filter(
      (u) => u.isActive() && types.includes(u.type()),
    );
  }
  unit(id: number): UnitView | undefined {
    return this._units.get(id);
  }
  unitInfo(type: UnitType): UnitInfo {
    return this._config.unitInfo(type);
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
  nations(): Nation[] {
    return this._mapData.nations;
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
  setFallout(ref: TileRef, value: boolean): void {
    return this._map.setFallout(ref, value);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
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
    // Mirror GameImpl/ScoutSwarmExecution on the client: snapshot the
    // owner + pre-mutation habitability, rewrite the terrain, and then
    // feed the delta back into the local SectorMap so derived habitability
    // UI (overlays, HUD income rates) stays in sync after a terraform.
    const ownerIdBefore = this._map.hasOwner(ref)
      ? this._map.ownerID(ref)
      : null;
    const previousHab =
      ownerIdBefore !== null ? this._sectorMap.effectiveHabitability(ref) : 0;
    this._map.setTerrainType(ref, type);
    if (ownerIdBefore !== null) {
      this._sectorMap.recomputeHabitabilityForTile(
        ref,
        ownerIdBefore,
        previousHab,
      );
    }
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
    // Snapshot the previous owner before the state is rewritten so we can
    // drive SectorMap's running per-player counters on the client. Without
    // this, `_sectorMap.perPlayer*` would stay zeroed on the view side and
    // any habitability-based HUD rate (`troopIncreaseRate`, `maxPopulation`,
    // `creditAdditionRate`) would diverge from the authoritative server
    // tick once the sector/habitability formulas are active.
    const prevOwnerID = this._map.ownerID(tile);
    this._map.updateTile(tile, state);
    const newOwnerID = this._map.ownerID(tile);
    if (prevOwnerID !== newOwnerID) {
      if (prevOwnerID !== 0) {
        this._sectorMap.recordTileLost(prevOwnerID, tile);
      }
      if (newOwnerID !== 0) {
        this._sectorMap.recordTileGained(newOwnerID, tile);
      }
    }
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  gameID(): GameID {
    return this._gameID;
  }

  focusedPlayer(): PlayerView | null {
    return this.myPlayer();
  }
}
