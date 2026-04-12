import { Config } from "../configuration/Config";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import { AllPlayersStats, ClientID } from "../Schemas";
import { formatPlayerDisplayName } from "../Util";
import { GameMap, TileRef } from "./GameMap";
import {
  GameUpdate,
  GameUpdateType,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { HyperspaceLaneNetwork } from "./HyperspaceLaneNetwork";
import { MotionPlanRecord } from "./MotionPlans";
import { Planet } from "./Planet";
import { SectorMap } from "./SectorMap";
import { Stats } from "./Stats";
import { UnitPredicate } from "./UnitGrid";

function isEnumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
}

export type PlayerID = string;
export type Tick = number;
export type Credits = bigint;

export const AllPlayers = "AllPlayers" as const;

// export type GameUpdates = Record<GameUpdateType, GameUpdate[]>;
// Create a type that maps GameUpdateType to its corresponding update type
type UpdateTypeMap<T extends GameUpdateType> = Extract<GameUpdate, { type: T }>;

// Then use it to create the record type
export type GameUpdates = {
  [K in GameUpdateType]: UpdateTypeMap<K>[];
};

export interface MapPos {
  x: number;
  y: number;
}

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}
export const isDifficulty = (value: unknown): value is Difficulty =>
  isEnumValue(Difficulty, value);

export type Team = string;

export interface SpawnArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TeamGameSpawnAreas = Record<string, SpawnArea[]>;

export const Duos = "Duos" as const;
export const Trios = "Trios" as const;
export const Quads = "Quads" as const;
export const HumansVsNations = "Humans Vs Nations" as const;

export const ColoredTeams: Record<string, Team> = {
  Red: "Red",
  Blue: "Blue",
  Teal: "Teal",
  Purple: "Purple",
  Yellow: "Yellow",
  Orange: "Orange",
  Green: "Green",
  Bot: "Bot",
  Humans: "Humans",
  Nations: "Nations",
} as const;

export enum GameMapType {
  AsteroidBelt = "Asteroid Belt",
  SolSystem = "Sol System",
  OrionSector = "Orion Sector",
  Random = "Random",
}

export type GameMapName = keyof typeof GameMapType;

export const mapCategories: Record<string, GameMapType[]> = {
  space: [
    GameMapType.AsteroidBelt,
    GameMapType.SolSystem,
    GameMapType.OrionSector,
    GameMapType.Random,
  ],
};

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}
export const isGameType = (value: unknown): value is GameType =>
  isEnumValue(GameType, value);

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export enum RankedType {
  OneVOne = "1v1",
}

/**
 * Determines how a game ends.
 *
 * - `Elimination`: Last player/team standing wins. Triggered as soon as
 *   only one faction has any owned tiles left, with the existing 170-min
 *   hard timer falling back to "most tiles wins". This is the GDD-aligned
 *   Stellar default. See GDD §1, §10, §12.
 * - `Domination`: Legacy OpenFront behavior — first faction to reach the
 *   `percentageTilesOwnedToWin()` threshold (80% FFA / 95% Team) wins. Kept
 *   selectable so existing modes still work.
 *
 * Routed by `WinCheckExecution` based on `GameConfig.winCondition`.
 */
export enum WinCondition {
  Elimination = "elimination",
  Domination = "domination",
}

export const isWinCondition = (value: unknown): value is WinCondition =>
  isEnumValue(WinCondition, value);

/**
 * Per-player snapshot of GDD-aligned scoring metrics. Used by
 * `WinCheckExecution` to populate the win event so the client can show a
 * score breakdown on game end. See GDD §10 — Scoring.
 *
 * - `planetsConquered`: distinct sectors the player has owned at any point
 *   during the run (counted via `SectorMap.sectorOf` on first conquest).
 * - `systemsControlled`: sectors currently owned at the time of the
 *   snapshot (any tile of the sector owned counts as controlled).
 * - `survivalTicks`: total ticks the player was alive — `killedAt` for
 *   eliminated players, the current tick for survivors.
 * - `eliminationRank`: 1 = first eliminated, ..., highest = winner. Equal
 *   to `players().length` for the last player standing.
 */
export interface RunPlayerScore {
  clientID: ClientID | null;
  playerID: PlayerID;
  name: string;
  planetsConquered: number;
  systemsControlled: number;
  survivalTicks: number;
  eliminationRank: number;
}

/**
 * Aggregate score payload for a single run. Serialized into the
 * {@link GameUpdateType.Win} update so the client can render the legacy
 * roguelike score screen on game end.
 */
export interface RunScore {
  totalTicks: number;
  winCondition: WinCondition;
  players: RunPlayerScore[];
}

/**
 * GDD §10 — Persisted run score with metadata for the legacy screen.
 * Serialized to localStorage as a JSON array after each game end.
 */
export interface PersistedRunScore extends RunScore {
  date: string;
  mapSeed: number | null;
  mapName: string;
  result: "win" | "loss";
}

export const isGameMode = (value: unknown): value is GameMode =>
  isEnumValue(GameMode, value);

export enum GameMapSize {
  Compact = "Compact",
  Normal = "Normal",
}

export interface PublicGameModifiers {
  isCompact?: boolean;
  isRandomSpawn?: boolean;
  isCrowded?: boolean;
  isHardNations?: boolean;
  startingCredits?: number;
  creditMultiplier?: number;
  isAlliancesDisabled?: boolean;
  isSpaceportsDisabled?: boolean;
  isNukesDisabled?: boolean;
  isPointDefenseDisabled?: boolean;
  isPeaceTime?: boolean;
}

export interface UnitInfo {
  cost: (game: Game, player: Player) => Credits;
  maxHealth?: number;
  damage?: number;
  constructionDuration?: number;
  upgradable?: boolean;
}

function unitTypeGroup<T extends readonly UnitType[]>(types: T) {
  return {
    types,
    has(type: UnitType): type is T[number] {
      return (types as readonly UnitType[]).includes(type);
    },
  };
}

export enum UnitType {
  AssaultShuttle = "Assault Shuttle",
  Battlecruiser = "Battlecruiser",
  PlasmaBolt = "Plasma Bolt",
  PointDefenseMissile = "PointDefenseMissile",
  Spaceport = "Spaceport",
  AntimatterTorpedo = "Antimatter Torpedo",
  NovaBomb = "Nova Bomb",
  TradeFreighter = "Trade Freighter",
  OrbitalStrikePlatform = "Orbital Strike Platform",
  DefenseStation = "Defense Station",
  PointDefenseArray = "Point Defense Array",
  Colony = "Colony",
  ClusterWarhead = "Cluster Warhead",
  ClusterWarheadSubmunition = "Cluster Warhead Submunition",
  Frigate = "Frigate",
  Foundry = "Foundry",
  // GDD §5 — Jump Gate: instant intra-faction (and allied) travel between
  // two paired gates. See Ticket 5: Structure Alignment.
  JumpGate = "Jump Gate",
  // GDD §4/§6 — Scout Swarm: temporary explorer unit launched for a fixed
  // percentage of the player's current credits. Travels toward a target
  // sector tile at 2 AU/min and terraforms it one magnitude step at a time
  // (AsteroidField → Nebula → OpenSpace). See Ticket 6: Fleet Systems.
  ScoutSwarm = "Scout Swarm",
}

export enum FrigateType {
  Engine = "Engine",
  TailEngine = "TailEngine",
  Carriage = "Carriage",
}

export const Nukes = unitTypeGroup([
  UnitType.AntimatterTorpedo,
  UnitType.NovaBomb,
  UnitType.ClusterWarheadSubmunition,
  UnitType.ClusterWarhead,
] as const);

export const BuildableAttacks = unitTypeGroup([
  UnitType.AntimatterTorpedo,
  UnitType.NovaBomb,
  UnitType.ClusterWarhead,
  UnitType.Battlecruiser,
] as const);

export const Structures = unitTypeGroup([
  UnitType.Colony,
  UnitType.DefenseStation,
  UnitType.PointDefenseArray,
  UnitType.OrbitalStrikePlatform,
  UnitType.Spaceport,
  UnitType.Foundry,
  UnitType.JumpGate,
] as const);

export const BuildMenus = unitTypeGroup([
  ...Structures.types,
  ...BuildableAttacks.types,
  // GDD §4/§6 — Scout Swarm shows up in the build menu even though it is
  // a temporary unit (not a structure and not a BuildableAttack). Keeping
  // it here means the build menu's `.buildables(tile, BuildMenus.types)`
  // call includes scout swarm cost/buildability without the callsite
  // needing to know about the PlayerBuildable union.
  UnitType.ScoutSwarm,
] as const);

export const PlayerBuildable = unitTypeGroup([
  ...BuildMenus.types,
  UnitType.AssaultShuttle,
  UnitType.ScoutSwarm,
] as const);

export type PlayerBuildableUnitType = (typeof PlayerBuildable.types)[number];

export interface OwnerComp {
  owner: Player;
}

export type TrajectoryTile = {
  tile: TileRef;
  targetable: boolean;
};
export interface UnitParamsMap {
  [UnitType.AssaultShuttle]: {
    population?: number;
    targetTile?: TileRef;
  };

  [UnitType.Battlecruiser]: {
    patrolTile: TileRef;
  };

  [UnitType.PlasmaBolt]: Record<string, never>;

  [UnitType.PointDefenseMissile]: Record<string, never>;

  [UnitType.Spaceport]: Record<string, never>;

  [UnitType.AntimatterTorpedo]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.NovaBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.TradeFreighter]: {
    targetUnit: Unit;
    lastSetSafeFromRaiders?: number;
  };

  [UnitType.Frigate]: {
    frigateType: FrigateType;
    targetUnit?: Unit;
    loaded?: boolean;
  };

  [UnitType.Foundry]: Record<string, never>;

  [UnitType.OrbitalStrikePlatform]: Record<string, never>;

  [UnitType.DefenseStation]: Record<string, never>;

  [UnitType.PointDefenseArray]: Record<string, never>;

  [UnitType.Colony]: Record<string, never>;

  [UnitType.JumpGate]: Record<string, never>;

  [UnitType.ScoutSwarm]: {
    targetTile: TileRef;
  };

  [UnitType.ClusterWarhead]: {
    targetTile?: number;
  };

  [UnitType.ClusterWarheadSubmunition]: {
    targetTile?: number;
  };
}

// Type helper to get params type for a specific unit type
export type UnitParams<T extends UnitType> = UnitParamsMap[T];

export type AllUnitParams = UnitParamsMap[keyof UnitParamsMap];

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

export class Nation {
  constructor(
    public readonly spawnCell: Cell | undefined,
    public readonly playerInfo: PlayerInfo,
  ) {}
}

export class Cell {
  public index: number;

  private strRepr: string;

  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    this.strRepr = `Cell[${this.x},${this.y}]`;
  }

  pos(): MapPos {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString(): string {
    return this.strRepr;
  }
}

export enum TerrainType {
  OpenSpace,
  Nebula,
  AsteroidField,
  DebrisField,
  DeepSpace,
}

export enum PlayerType {
  Bot = "BOT",
  Human = "HUMAN",
  Nation = "NATION",
}

export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
}

export interface Attack {
  id(): string;
  retreating(): boolean;
  retreated(): boolean;
  orderRetreat(): void;
  executeRetreat(): void;
  target(): Player | TerraNullius;
  attacker(): Player;
  population(): number;
  setPopulation(population: number): void;
  isActive(): boolean;
  delete(): void;
  // The tile the attack originated from, mostly used for shuttle attacks.
  sourceTile(): TileRef | null;
  addBorderTile(tile: TileRef): void;
  removeBorderTile(tile: TileRef): void;
  clearBorder(): void;
  borderSize(): number;
  clusteredPositions(): TileRef[];
}

export interface AllianceRequest {
  accept(): void;
  reject(): void;
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  status(): "pending" | "accepted" | "rejected";
}

export interface Alliance {
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  expiresAt(): Tick;
  other(player: Player): Player;
}

export interface MutableAlliance extends Alliance {
  expire(): void;
  other(player: Player): Player;
  bothAgreedToExtend(): boolean;
  addExtensionRequest(player: Player): void;
  id(): number;
  extend(): void;
  onlyOneAgreedToExtend(): boolean;

  agreedToExtend(player: Player): boolean;
}

export class PlayerInfo {
  public readonly displayName: string;

  constructor(
    public readonly name: string,
    public readonly playerType: PlayerType,
    // null if tribe.
    public readonly clientID: ClientID | null,
    public readonly id: PlayerID,
    public readonly isLobbyCreator: boolean = false,
    public readonly clanTag: string | null = null,
  ) {
    this.displayName = formatPlayerDisplayName(this.name, this.clanTag);
  }
}

export function isUnit(unit: unknown): unit is Unit {
  return (
    unit &&
    typeof unit === "object" &&
    "isUnit" in unit &&
    typeof unit.isUnit === "function" &&
    unit.isUnit()
  );
}

export interface Unit {
  isUnit(): this is Unit;

  // Common properties.
  id(): number;
  type(): UnitType;
  owner(): Player;
  info(): UnitInfo;
  isMarkedForDeletion(): boolean;
  markForDeletion(): void;
  isOverdueDeletion(): boolean;
  delete(displayMessage?: boolean, destroyer?: Player): void;
  tile(): TileRef;
  lastTile(): TileRef;
  move(tile: TileRef): void;
  isActive(): boolean;
  setOwner(owner: Player): void;
  touch(): void;
  hash(): number;
  toUpdate(): UnitUpdate;
  hasTradeHub(): boolean;
  setTradeHub(tradeHub: boolean): void;
  wasDestroyedByEnemy(): boolean;
  destroyer(): Player | undefined;

  // Frigate
  frigateType(): FrigateType | undefined;
  isLoaded(): boolean | undefined;
  setLoaded(loaded: boolean): void;

  // Targeting
  setTargetTile(cell: TileRef | undefined): void;
  targetTile(): TileRef | undefined;
  setTrajectoryIndex(i: number): void;
  trajectoryIndex(): number;
  trajectory(): TrajectoryTile[];
  setTargetUnit(unit: Unit | undefined): void;
  targetUnit(): Unit | undefined;
  setTargetedByPointDefense(targeted: boolean): void;
  targetedByPointDefense(): boolean;
  setReachedTarget(): void;
  reachedTarget(): boolean;
  isTargetable(): boolean;
  setTargetable(targetable: boolean): void;

  // Health
  hasHealth(): boolean;
  retreating(): boolean;
  orderShuttleRetreat(): void;
  health(): number;
  modifyHealth(delta: number, attacker?: Player): void;

  // Population
  setPopulation(population: number): void;
  population(): number;

  // --- UNIT SPECIFIC ---

  // Point Defense & Orbital Strike Platforms
  launch(): void;
  reloadMissile(): void;
  isInCooldown(): boolean;
  missileTimerQueue(): number[];

  // Trade Freighters
  setSafeFromRaiders(): void; // Only for trade freighters
  isSafeFromRaiders(): boolean; // Only for trade freighters

  // Construction phase on structures
  isUnderConstruction(): boolean;
  setUnderConstruction(underConstruction: boolean): void;

  // Upgradable Structures
  level(): number;
  increaseLevel(): void;
  decreaseLevel(destroyer?: Player): void;

  // Battlecruisers
  setPatrolTile(tile: TileRef): void;
  patrolTile(): TileRef | undefined;
  /**
   * GDD §14 / Ticket 6 — Battlecruiser structure slot. A Battlecruiser can
   * host a single DefenseStation or OrbitalStrikePlatform that travels with
   * it and is destroyed when the ship dies. The setter throws when the slot
   * is already occupied; pass `undefined` to clear it.
   */
  setSlottedStructure(structure: Unit | undefined): void;
  slottedStructure(): Unit | undefined;
}

export interface TerraNullius {
  isPlayer(): false;
  id(): null;
  clientID(): ClientID;
  smallID(): number;
}

export interface Embargo {
  createdAt: Tick;
  isTemporary: boolean;
  target: Player;
}

export interface Player {
  // Basic Info
  smallID(): number;
  info(): PlayerInfo;
  name(): string;
  displayName(): string;
  clientID(): ClientID | null;
  id(): PlayerID;
  type(): PlayerType;
  isPlayer(): this is Player;
  toString(): string;
  isLobbyCreator(): boolean;

  // State & Properties
  isAlive(): boolean;
  isTraitor(): boolean;
  markTraitor(): void;
  largestClusterBoundingBox: { min: Cell; max: Cell } | null;
  lastTileChange(): Tick;

  isDisconnected(): boolean;
  markDisconnected(isDisconnected: boolean): void;

  hasSpawned(): boolean;
  setSpawnTile(spawnTile: TileRef): void;
  spawnTile(): TileRef | undefined;

  // Territory
  tiles(): ReadonlySet<TileRef>;
  borderTiles(): ReadonlySet<TileRef>;
  numTilesOwned(): number;
  conquer(tile: TileRef): void;
  relinquish(tile: TileRef): void;

  // Credits & Population
  credits(): Credits;
  addCredits(toAdd: Credits, tile?: TileRef): void;
  removeCredits(toRemove: Credits): Credits;
  population(): number;
  setPopulation(population: number): void;
  addPopulation(population: number): void;
  removePopulation(population: number): number;

  // Units
  units(...types: UnitType[]): Unit[];
  unitCount(type: UnitType): number;
  unitsConstructed(type: UnitType): number;
  unitsOwned(type: UnitType): number;
  buildableUnits(
    tile: TileRef | null,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[];
  canBuild(
    type: UnitType,
    targetTile: TileRef,
    validTiles?: TileRef[] | null,
  ): TileRef | false;
  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit;

  // Returns the existing unit that can be upgraded,
  // or false if it cannot be upgraded.
  // New units of the same type can upgrade existing units.
  // e.g. if I place a new colony here, can it upgrade an existing colony?
  findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false;
  canUpgradeUnit(unit: Unit): boolean;
  upgradeUnit(unit: Unit): void;
  captureUnit(unit: Unit): void;

  // Relations & Diplomacy
  neighbors(): (Player | TerraNullius)[];
  sharesBorderWith(other: Player | TerraNullius): boolean;
  relation(other: Player): Relation;
  allRelationsSorted(): { player: Player; relation: Relation }[];
  updateRelation(other: Player, delta: number): void;
  decayRelations(): void;
  isOnSameTeam(other: Player): boolean;
  // Either allied or on same team.
  isFriendly(other: Player, treatAFKFriendly?: boolean): boolean;
  team(): Team | null;
  incomingAllianceRequests(): AllianceRequest[];
  outgoingAllianceRequests(): AllianceRequest[];
  alliances(): MutableAlliance[];
  expiredAlliances(): Alliance[];
  allies(): Player[];
  isAlliedWith(other: Player): boolean;
  allianceWith(other: Player): MutableAlliance | null;
  allianceInfo(other: Player): AllianceInfo | null;
  canSendAllianceRequest(other: Player): boolean;
  breakAlliance(alliance: Alliance): void;
  removeAllAlliances(): void;
  createAllianceRequest(recipient: Player): AllianceRequest | null;
  betrayals(): number;

  // Targeting
  canTarget(other: Player): boolean;
  target(other: Player): void;
  targets(): Player[];
  transitiveTargets(): Player[];

  // Communication
  canSendEmoji(recipient: Player | typeof AllPlayers): boolean;
  outgoingEmojis(): EmojiMessage[];
  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void;

  // Donation
  canDonateCredits(recipient: Player): boolean;
  canDonatePopulation(recipient: Player): boolean;
  donatePopulation(recipient: Player, population: number): boolean;
  donateCredits(recipient: Player, credits: Credits): boolean;
  canDeleteUnit(): boolean;
  recordDeleteUnit(): void;
  canEmbargoAll(): boolean;
  recordEmbargoAll(): void;

  // Embargo
  hasEmbargoAgainst(other: Player): boolean;
  tradingPartners(): Player[];
  addEmbargo(other: Player, isTemporary: boolean): void;
  getEmbargoes(): Embargo[];
  stopEmbargo(other: Player): void;
  endTemporaryEmbargo(other: Player): void;
  canTrade(other: Player): boolean;

  // Attacking.
  canAttack(tile: TileRef): boolean;
  canAttackPlayer(player: Player, treatAFKFriendly?: boolean): boolean;
  isImmune(): boolean;

  createAttack(
    target: Player | TerraNullius,
    population: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack;
  outgoingAttacks(): Attack[];
  incomingAttacks(): Attack[];
  orderRetreat(attackID: string): void;
  executeRetreat(attackID: string): void;

  // Misc
  toUpdate(): PlayerUpdate;
  playerProfile(): PlayerProfile;
  // WARNING: this operation is expensive.
  bestShuttleSpawn(tile: TileRef): TileRef | false;

  // Poisoned ports: destination tiles where shuttle pathfinding has failed.
  // Recorded on PATH_NOT_FOUND so future launches skip known-unreachable ports.
  addPoisonedPort(tile: TileRef): void;
  isPoisonedPort(tile: TileRef): boolean;
}

export interface Game extends GameMap {
  // Map & Dimensions
  isOnMap(cell: Cell): boolean;
  width(): number;
  height(): number;
  map(): GameMap;
  miniMap(): GameMap;
  forEachTile(fn: (tile: TileRef) => void): void;
  // Zero-allocation neighbor iteration (cardinal only) to avoid creating arrays
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void;
  // Zero-allocation neighbor iteration for performance-critical cluster calculation
  // Alternative to neighborsWithDiag() that returns arrays
  // Avoids creating intermediate arrays and uses a callback for better performance
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void;

  // Player Management
  player(id: PlayerID): Player;
  players(): Player[];
  allPlayers(): Player[];
  playerByClientID(id: ClientID): Player | null;
  playerBySmallID(id: number): Player | TerraNullius;
  hasPlayer(id: PlayerID): boolean;
  addPlayer(playerInfo: PlayerInfo): Player;
  terraNullius(): TerraNullius;
  owner(ref: TileRef): Player | TerraNullius;

  teams(): Team[];
  teamSpawnArea(team: Team): SpawnArea | undefined;

  // Alliances
  alliances(): MutableAlliance[];
  expireAlliance(alliance: Alliance): void;

  // Peace voting — allies endorse a player as winner; recorded as assists in the Winner tuple.
  recordPeaceVote(voter: Player, target: Player): void;
  peaceVotesByTarget(target: Player): Player[];

  // Immunity timer
  isSpawnImmunityActive(): boolean;
  isNationSpawnImmunityActive(): boolean;

  // Game State
  ticks(): Tick;
  inSpawnPhase(): boolean;
  executeNextTick(): GameUpdates;
  drainPackedTileUpdates(): Uint32Array;
  /**
   * Drains any terrain mutations recorded this tick as packed
   * `[tileRef, terrainType]` uint32 pairs. Empty array when no terrain
   * was mutated — terrain changes are rare (primarily Scout Swarm
   * terraforming) so the common case is a zero-length buffer.
   */
  drainPackedTerrainUpdates(): Uint32Array;
  recordMotionPlan(record: MotionPlanRecord): void;
  drainPackedMotionPlans(): Uint32Array | null;
  setWinner(winner: Player | Team, allPlayersStats: AllPlayersStats): void;
  getWinner(): Player | Team | null;
  config(): Config;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  /**
   * GDD §10 scoring snapshot — planets conquered, systems controlled,
   * survival time, elimination ranks. Built on demand by `WinCheckExecution`
   * just before {@link setWinner}; returns `null` if the Stats tracker has
   * not been wired with a SectorMap (test-only path).
   */
  runScore(): RunScore | null;
  /**
   * GDD §12 — permadeath gate. Returns `false` if the run is in permadeath
   * mode and the player has already been eliminated, so the rejoin path
   * can refuse the connection. Returns `true` for everyone in non-permadeath
   * runs.
   */
  canPlayerRejoin(player: Player): boolean;

  // Units
  units(...types: UnitType[]): Unit[];
  unitCount(type: UnitType): number;
  unitInfo(type: UnitType): UnitInfo;
  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }>;

  addExecution(...exec: Execution[]): void;
  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    creditAmount?: bigint,
    params?: Record<string, string | number>,
  ): void;
  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void;

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void;

  // Nations
  nations(): Nation[];

  // Sector partitioning derived from manifest nations at game init.
  // See SectorMap and GDD Economy Alignment Approach §3.
  sectorMap(): SectorMap;

  /**
   * GDD §2 — discrete `Planet` entities wrapping each non-empty
   * sector. The same array reference is returned on repeated calls
   * during a single game (built once at GameImpl construction time)
   * so holding a snapshot is safe.
   *
   * Ordered by ascending sector id — which for a manifest-authored
   * map matches the order nations appear in the map manifest.
   */
  planets(): readonly Planet[];

  /**
   * GDD §2 — convenience lookup that returns the {@link Planet} whose
   * sector contains `tile`, or `null` if the tile lies outside every
   * nation sector (sector id 0). Used by slot-limit checks and any
   * other call site that needs to route "this tile's planet" decisions
   * through the Planet abstraction instead of poking at raw sector IDs.
   */
  planetByTile(tile: TileRef): Planet | null;

  // GDD §4 / Ticket 6 — Scout Swarm terraform accumulation. Multiple scout
  // swarms can stack on the same target to terraform it faster; the
  // shared per-tile counter lives on `Game` so every ScoutSwarmExecution
  // sees the same accumulator. `recordScoutSwarmTerraformProgress`
  // increments and returns the new value; `resetScoutSwarmTerraformProgress`
  // clears the counter once a terraform step is applied;
  // `scoutSwarmTerraformProgress` is a read-only accessor used by tests.
  recordScoutSwarmTerraformProgress(tile: TileRef): number;
  resetScoutSwarmTerraformProgress(tile: TileRef): void;
  scoutSwarmTerraformProgress(tile: TileRef): number;

  // GDD §8 / Ticket 8 — Defense Satellite vs LRW duel loop. The Long-Range
  // Weapon (OrbitalStrikePlatform) projectile is intentionally NOT a Unit
  // — see the design comment in OrbitalStrikePlatformExecution. To still
  // give DefenseStations something to intercept, GameImpl maintains a
  // small registry of pending LRW impacts: the OSP execution registers
  // each scheduled impact at fire time and unregisters it when applied,
  // and DefenseStationExecution queries `pendingLrwImpactsNear` plus
  // `interceptPendingLrwImpact` to swat them down inside its targetting
  // envelope. Tokens are opaque integers; callers should treat them as
  // identity handles.
  registerPendingLrwImpact(
    ownerSmallID: number,
    fireTile: TileRef,
    targetTile: TileRef,
    impactTick: number,
  ): number;
  unregisterPendingLrwImpact(token: number): void;
  isPendingLrwImpactActive(token: number): boolean;
  pendingLrwImpactsNear(
    tile: TileRef,
    range: number,
    excludeOwnerSmallID?: number,
  ): Array<{
    token: number;
    targetTile: TileRef;
    ownerSmallID: number;
    distSquared: number;
  }>;
  interceptPendingLrwImpact(token: number): boolean;

  numTilesWithFallout(): number;
  stats(): Stats;

  addUpdate(update: GameUpdate): void;
  hyperspaceLaneNetwork(): HyperspaceLaneNetwork;
  conquerPlayer(conqueror: Player, conquered: Player): void;
  miniDeepSpaceHPA(): PathFinder<number> | null;
  miniDeepSpaceGraph(): AbstractGraph | null;
  getDeepSpaceComponent(tile: TileRef): number | null;
  hasDeepSpaceComponent(tile: TileRef, component: number): boolean;
}

export interface PlayerActions {
  canAttack: boolean;
  buildableUnits: BuildableUnit[];
  canSendEmojiAllPlayers: boolean;
  canEmbargoAll?: boolean;
  interaction?: PlayerInteraction;
}

export interface BuildableUnit {
  canBuild: TileRef | false;
  // unit id of the existing unit that can be upgraded, or false if it cannot be upgraded.
  canUpgrade: number | false;
  type: PlayerBuildableUnitType;
  cost: Credits;
  overlappingHyperspaceLanes: number[];
  ghostHyperspaceLanePaths: TileRef[][];
  /**
   * When `canBuild === false`, an optional machine-readable rejection tag
   * that explains *why* the build is unavailable. Populated per-unit-type
   * on a best-effort basis (currently only AssaultShuttle) so the UI can
   * surface a human-readable tooltip on the disabled build button.
   */
  rejectReason?: string;
}

export interface PlayerProfile {
  relations: Record<number, Relation>;
  alliances: number[];
}

export interface PlayerBorderTiles {
  borderTiles: ReadonlySet<TileRef>;
}

export interface AllianceInfo {
  expiresAt: Tick;
  inExtensionWindow: boolean;
  myPlayerAgreedToExtend: boolean;
  otherAgreedToExtend: boolean;
  canExtend: boolean;
}

export interface PlayerInteraction {
  sharedBorder: boolean;
  canSendEmoji: boolean;
  canSendAllianceRequest: boolean;
  canBreakAlliance: boolean;
  canTarget: boolean;
  canDonateCredits: boolean;
  canDonatePopulation: boolean;
  canEmbargo: boolean;
  allianceInfo?: AllianceInfo;
}

export interface EmojiMessage {
  message: string;
  senderID: number;
  recipientID: number | typeof AllPlayers;
  createdAt: Tick;
}

export enum MessageType {
  ATTACK_FAILED,
  ATTACK_CANCELLED,
  ATTACK_REQUEST,
  CONQUERED_PLAYER,
  CLUSTER_WARHEAD_INBOUND,
  NUKE_INBOUND,
  NOVA_BOMB_INBOUND,
  ORBITAL_ASSAULT_INBOUND,
  POINT_DEFENSE_MISS,
  POINT_DEFENSE_HIT,
  CAPTURED_ENEMY_UNIT,
  UNIT_CAPTURED_BY_ENEMY,
  UNIT_DESTROYED,
  ALLIANCE_ACCEPTED,
  ALLIANCE_REJECTED,
  ALLIANCE_REQUEST,
  ALLIANCE_BROKEN,
  ALLIANCE_EXPIRED,
  SENT_CREDITS_TO_PLAYER,
  RECEIVED_CREDITS_FROM_PLAYER,
  RECEIVED_CREDITS_FROM_TRADE,
  SENT_TROOPS_TO_PLAYER,
  RECEIVED_TROOPS_FROM_PLAYER,
  CHAT,
  RENEW_ALLIANCE,
  PEACE_VOTE,
}

// Message categories used for filtering events in the EventsDisplay
export enum MessageCategory {
  ATTACK = "ATTACK",
  NUKE = "NUKE",
  ALLIANCE = "ALLIANCE",
  TRADE = "TRADE",
  CHAT = "CHAT",
}

// Ensures that all message types are included in a category
export const MESSAGE_TYPE_CATEGORIES: Record<MessageType, MessageCategory> = {
  [MessageType.ATTACK_FAILED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_CANCELLED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_REQUEST]: MessageCategory.ATTACK,
  [MessageType.CONQUERED_PLAYER]: MessageCategory.ATTACK,
  [MessageType.CLUSTER_WARHEAD_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_INBOUND]: MessageCategory.NUKE,
  [MessageType.NOVA_BOMB_INBOUND]: MessageCategory.NUKE,
  [MessageType.ORBITAL_ASSAULT_INBOUND]: MessageCategory.ATTACK,
  [MessageType.POINT_DEFENSE_MISS]: MessageCategory.ATTACK,
  [MessageType.POINT_DEFENSE_HIT]: MessageCategory.ATTACK,
  [MessageType.CAPTURED_ENEMY_UNIT]: MessageCategory.ATTACK,
  [MessageType.UNIT_CAPTURED_BY_ENEMY]: MessageCategory.ATTACK,
  [MessageType.UNIT_DESTROYED]: MessageCategory.ATTACK,
  [MessageType.ALLIANCE_ACCEPTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REJECTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REQUEST]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_BROKEN]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_EXPIRED]: MessageCategory.ALLIANCE,
  [MessageType.RENEW_ALLIANCE]: MessageCategory.ALLIANCE,
  [MessageType.SENT_CREDITS_TO_PLAYER]: MessageCategory.TRADE,
  [MessageType.RECEIVED_CREDITS_FROM_PLAYER]: MessageCategory.TRADE,
  [MessageType.RECEIVED_CREDITS_FROM_TRADE]: MessageCategory.TRADE,
  [MessageType.SENT_TROOPS_TO_PLAYER]: MessageCategory.TRADE,
  [MessageType.RECEIVED_TROOPS_FROM_PLAYER]: MessageCategory.TRADE,
  [MessageType.CHAT]: MessageCategory.CHAT,
  [MessageType.PEACE_VOTE]: MessageCategory.ALLIANCE,
} as const;

/**
 * Get the category of a message type
 */
export function getMessageCategory(messageType: MessageType): MessageCategory {
  return MESSAGE_TYPE_CATEGORIES[messageType];
}

export interface NameViewData {
  x: number;
  y: number;
  size: number;
}
