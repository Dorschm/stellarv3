import { Colord } from "colord";
import { JWK } from "jose";
import {
  Credits,
  Game,
  Player,
  PlayerInfo,
  Team,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
  WinCondition,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, GameID, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export interface ServerConfig {
  turnstileSiteKey(): string;
  turnstileSecretKey(): string;
  turnIntervalMs(): number;
  /**
   * GDD §10 — server-side dynamic tick-rate. Maps a 0..1 progress signal
   * (typically wall-clock elapsed-time fraction; the simulation lives
   * client-side so the server can't read player tile counts directly) onto
   * the desired turn interval in ms, interpolated between
   * {@link maxTurnIntervalMs} (slow start) and {@link minTurnIntervalMs}
   * (fast end). Mirrors the same-named method on the game {@link Config}
   * so balance lives in one place.
   */
  dynamicTurnIntervalMs(progress: number): number;
  minTurnIntervalMs(): number;
  maxTurnIntervalMs(): number;
  gameCreationRate(): number;
  numWorkers(): number;
  workerIndex(gameID: GameID): number;
  workerPath(gameID: GameID): string;
  workerPort(gameID: GameID): number;
  workerPortByIndex(workerID: number): number;
  env(): GameEnv;
  adminToken(): string;
  adminHeader(): string;
  // Only available on the server
  gitCommit(): string;
  apiKey(): string;
  otelEndpoint(): string;
  otelAuthHeader(): string;
  otelEnabled(): boolean;
  jwtAudience(): string;
  jwtIssuer(): string;
  jwkPublicKey(): Promise<JWK>;
  domain(): string;
  subdomain(): string;
  stripePublishableKey(): string;
  allowedFlares(): string[] | undefined;
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

export interface Config {
  spawnImmunityDuration(): Tick;
  nationSpawnImmunityDuration(): Tick;
  hasExtendedSpawnImmunity(): boolean;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  updateGameConfig(config: Partial<GameConfig>): void;
  theme(): Theme;
  percentageTilesOwnedToWin(): number;
  /**
   * Active win-condition mode (elimination vs domination). Routed by
   * `WinCheckExecution`. Defaults to `Domination` for legacy public lobbies;
   * GDD-aligned Stellar mode opts in to `Elimination` via the game config.
   * See {@link WinCondition}.
   */
  winCondition(): WinCondition;
  /**
   * Permadeath flag. When `true`, eliminated players cannot rejoin a run
   * once their territory is gone. Wired into `RejoinService` via
   * `Game.canPlayerRejoin()` so the meta-layer can later log a final
   * legacy score. See GDD §12.
   */
  permadeath(): boolean;
  numBots(): number;
  spawnNations(): boolean;
  isUnitDisabled(unitType: UnitType): boolean;
  bots(): number;
  infiniteCredits(): boolean;
  donateCredits(): boolean;
  infinitePopulation(): boolean;
  donatePopulation(): boolean;
  instantBuild(): boolean;
  disableNavMesh(): boolean;
  disableAlliances(): boolean;
  isRandomSpawn(): boolean;
  numSpawnPhaseTurns(): number;
  userSettings(): UserSettings;
  playerTeams(): TeamCountConfig;
  creditMultiplier(): number;
  startingCredits(playerInfo: PlayerInfo): Credits;

  startPopulation(playerInfo: PlayerInfo): number;
  troopIncreaseRate(player: Player | PlayerView): number;
  creditAdditionRate(player: Player | PlayerView): Credits;
  attackTilesPerTick(
    attckPopulation: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number;
  attackLogic(
    gm: Game,
    attackPopulation: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  };
  attackAmount(attacker: Player, defender: Player | TerraNullius): number;
  radiusSpaceportSpawn(): number;
  // When computing likelihood of trading for any given spaceport, the X closest spaceport
  // are twice more likely to be selected. X is determined below.
  proximityBonusSpaceportsNb(totalSpaceports: number): number;
  maxPopulation(player: Player | PlayerView): number;
  colonyTroopIncrease(): number;
  /**
   * GDD §14 — per-tick population trickle added by a Battlecruiser-hosted
   * Colony. Ship-hosted Colonies sit on deep-space tiles (zero habitability)
   * so the normal hab-weighted growth formula in {@link troopIncreaseRate}
   * contributes nothing on their behalf. This fixed rate ensures a hosted
   * Colony pulls its weight as one of the cruiser's single mobile slot.
   */
  shipHostedColonyPopulationPerTick(): number;
  /**
   * GDD §14 — per-tick credit trickle added by a Battlecruiser-hosted
   * Foundry. Mirrors {@link shipHostedColonyPopulationPerTick} — without
   * this, a ship-hosted Foundry on a void tile contributes nothing to the
   * player's income because `creditAdditionRate` is tile/habitability
   * driven.
   */
  shipHostedFoundryCreditsPerTick(): number;
  shuttleAttackAmount(
    attacker: Player,
    defender: Player | TerraNullius,
  ): number;
  plasmaBoltLifetime(): number;
  shuttleMaxNumber(): number;
  /**
   * Assault Fleet travel speed expressed as the integer number of ticks
   * needed to traverse a single tile.
   *
   * GDD §6 nominally specifies Assault Fleet speed at 1 AU/min, which
   * with the project's AU = 100 tiles convention would resolve to roughly
   * 6 ticks/tile (10 ticks/s × 60 s/min ÷ 100 tiles/AU). This is a
   * **deliberate deviation**: the shipped configuration uses 1 tick/tile
   * so AssaultShuttles travel at the same cadence as the Battlecruiser
   * they often accompany, keeping fleet movement readable and combat
   * pacing tight. See the AssaultShuttle row in `stellar-gdd-gap-report.md`
   * (`DEVIATION`) and `docs/product-decisions.md` for the rationale.
   */
  assaultShuttleTicksPerTile(): number;
  allianceDuration(): Tick;
  allianceRequestDuration(): Tick;
  allianceRequestCooldown(): Tick;
  temporaryEmbargoDuration(): Tick;
  targetDuration(): Tick;
  targetCooldown(): Tick;
  emojiMessageCooldown(): Tick;
  emojiMessageDuration(): Tick;
  donateCooldown(): Tick;
  embargoAllCooldown(): Tick;
  deletionMarkDuration(): Tick;
  deleteUnitCooldown(): Tick;
  defaultDonationAmount(sender: Player): number;
  unitInfo(type: UnitType): UnitInfo;
  tradeFreighterShortRangeDebuff(): number;
  tradeFreighterCredits(dist: number): Credits;
  tradePopulationFraction(): number;
  tradeFreighterSpawnRate(
    tradeFreighterSpawnRejections: number,
    numTradeFreighters: number,
  ): number;
  frigateCredits(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
  ): Credits;
  frigateSpawnRate(numPlayerFoundries: number): number;
  tradeHubMinRange(): number;
  tradeHubMaxRange(): number;
  hyperspaceLaneMaxSize(): number;
  safeFromRaidersCooldownMax(): number;
  defenseStationRange(): number;
  pointDefenseCooldown(): number;
  orbitalStrikeCooldown(): number;
  minDistanceBetweenPlayers(): number;
  defenseStationDefenseBonus(): number;
  defenseStationSpeedBonus(): number;
  falloutDefenseModifier(percentOfFallout: number): number;
  battlecruiserPatrolRange(): number;
  battlecruiserPlasmaBoltAttackRate(): number;
  battlecruiserTargettingRange(): number;
  /**
   * GDD §14 — Euclidean radius (in tiles) of the territorial "wake" the
   * Battlecruiser leaves behind as it patrols. On every movement step the
   * cruiser converts deep-space tiles within this radius into sector
   * tiles and claims any unowned sector tiles it passes over. Enemy- or
   * ally-owned tiles are left untouched.
   */
  battlecruiserTerritoryRadius(): number;
  /**
   * GDD §14 — set of structure types that a Battlecruiser may host in its
   * single mobile slot. A Battlecruiser acts as a "mobile one-slot planet",
   * so in principle every ground-buildable structure is hostable. Exposed
   * as a config method so balance tuning (e.g. excluding a type for a mode
   * variant) can happen without editing execution code.
   */
  battlecruiserHostableStructures(): readonly UnitType[];
  defenseStationPlasmaBoltAttackRate(): number;
  defenseStationTargettingRange(): number;
  // 0-1
  traitorDefenseDebuff(): number;
  traitorDuration(): number;
  nukeMagnitudes(unitType: UnitType): NukeMagnitude;
  // Number of tiles destroyed to break an alliance
  nukeAllianceBreakThreshold(): number;
  defaultNukeSpeed(): number;
  defaultNukeTargetableRange(): number;
  defaultPointDefenseMissileSpeed(): number;
  defaultPointDefenseRange(): number;
  pointDefenseRange(level: number): number;
  maxPointDefenseRange(): number;
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxPopulation: number,
  ): number;
  structureMinDist(): number;
  isReplay(): boolean;
  allianceExtensionPromptOffset(): number;

  // ---- Ticket 7: Dynamic tick-rate scaling --------------------------------
  /**
   * Minimum tick interval in ms (max game speed). GDD §10 — game speeds up
   * as players expand, floored at 50ms (20 tps) to prevent client desync.
   */
  minTurnIntervalMs(): number;
  /**
   * Maximum tick interval in ms (base game speed). Defaults to 100ms (10 tps).
   */
  maxTurnIntervalMs(): number;
  /**
   * Calculate the current dynamic tick interval based on leading player
   * expansion. Returns a value in [minTurnIntervalMs, maxTurnIntervalMs].
   */
  dynamicTurnIntervalMs(leadingPlayerTileRatio: number): number;

  // ---- Ticket 5: AU Convention --------------------------------------------
  /**
   * Tiles-per-AU conversion. Used everywhere the GDD speaks in astronomical
   * units (LRW projectile speed, scout swarm travel speed, hyperspace lane
   * reach). Implementation returns a constant — see `AU_IN_TILES` in
   * DefaultConfig.ts for the tuning rationale.
   */
  auInTiles(): number;

  // ---- Ticket 5: Long-Range Weapon ----------------------------------------
  /**
   * Credit cost to fire one LRW shot from an Orbital Strike Platform.
   * Deducted from the platform owner when the shot is scheduled.
   */
  longRangeWeaponShotCost(): bigint;
  /**
   * LRW projectile travel speed in tiles-per-tick. Derived from the GDD's
   * "3 AU/s" figure via `auInTiles()`, rounded to an integer tile count so
   * the impact scheduling arithmetic stays in fixed-point land.
   */
  longRangeWeaponProjectileSpeed(): number;
  /**
   * Maximum tile radius the LRW targeting scan sweeps when looking for an
   * enemy-owned tile. Bounded by `defaultNukeTargetableRange()` so the LRW
   * never out-reaches the existing nuke envelope.
   */
  longRangeWeaponMaxRange(): number;
  /**
   * Fraction (0..1) of the target player's current population that the LRW
   * impact subtracts. GDD §5 calls for 10% population damage.
   */
  longRangeWeaponPopulationDamageRatio(): number;
  /**
   * Flat habitability damage (0..1) applied to the impacted tile on the
   * SectorMap overlay. GDD §5 calls for 10% habitability damage.
   */
  longRangeWeaponHabitabilityDamage(): number;

  // ---- Ticket 6: Fleet Systems — Scout Swarm ------------------------------
  /**
   * Launch cost for a single Scout Swarm as a *fraction* (0..1) of the
   * player's current credits. GDD §4 specifies "10% of total credits".
   * ScoutSwarmExecution reads this at launch time and deducts
   * `player.credits() * scoutSwarmCostFraction()` rounded to bigint.
   */
  scoutSwarmCostFraction(): number;
  /**
   * Scout Swarm travel speed in tiles per tick. Derived from the GDD's
   * "2 AU/min" figure via `auInTiles()` — kept behind a method so balance
   * changes to either the AU constant or the scout speed stay in one place.
   */
  scoutSwarmTilesPerTick(): number;
  /**
   * Maximum lifetime of a scout swarm in ticks, after which the swarm
   * auto-dissolves even if it never reached its target. Prevents stranded
   * swarms from hanging around forever when the target becomes unreachable.
   */
  scoutSwarmLifetimeTicks(): Tick;
  /**
   * Amount of swarm "accumulation" that must build up on a single target
   * tile before its terrain steps down one level (AsteroidField → Nebula,
   * Nebula → OpenSpace). GDD §4 quotes "10 swarm size/km²"; we use 10
   * scout-arrivals per tile in the absence of a physical km² conversion.
   */
  scoutSwarmTerraformAccumulation(): number;
  /**
   * GDD §4 — scouts terraform a cluster of deep-space tiles centred on
   * the arrival target. Returned value is the Euclidean radius (in tiles)
   * passed to {@link Game.circleSearch}. Trail tiles along the scout's
   * flight path use a fixed 1-tile width and do not read this value.
   */
  scoutSwarmClusterRadius(): number;
  /**
   * GDD §3.1 — "Population uses: colonize/terraform planets." Fixed
   * population cost deducted at scout swarm launch. ScoutSwarmExecution
   * calls `launcher.removePopulation(scoutSwarmPopulationCost())` directly
   * — the cost does NOT scale with empire size or population cap. Soft
   * cost: if the launcher has insufficient current population the launch
   * still succeeds and `removePopulation` simply deducts up to available.
   */
  scoutSwarmPopulationCost(): number;

  // ---- GDD §3.2: Fleet Upkeep ---------------------------------------------
  /**
   * Recurring credit drain per tick for each active Assault Shuttle owned
   * by a player. GDD §3.2 — "Resources uses: maintain fleets." Reaching 0
   * credits does not destroy the fleet; the drain is strategic pressure,
   * not a kill switch.
   *
   * Owner-aware: scales via the same Bot/Nation-difficulty pattern used
   * for {@link troopIncreaseRate} / {@link creditAdditionRate} so Easy
   * bots pay less than Humans and higher-difficulty Nations pay more.
   */
  assaultShuttleUpkeepPerTick(owner?: Player | PlayerView): Credits;
  /**
   * Recurring credit drain per tick for each active Battlecruiser owned
   * by a player. See {@link assaultShuttleUpkeepPerTick} for the GDD
   * reference, owner-aware scaling, and bankruptcy semantics.
   */
  battlecruiserUpkeepPerTick(owner?: Player | PlayerView): Credits;
  /**
   * Recurring credit drain per tick for each active Trade Freighter
   * owned by a player. See {@link assaultShuttleUpkeepPerTick} for the
   * GDD reference, owner-aware scaling, and bankruptcy semantics.
   */
  tradeFreighterUpkeepPerTick(owner?: Player | PlayerView): Credits;

  // ---- Ticket 6: Battlecruiser structure slot -----------------------------
  /**
   * Number of structures a single Battlecruiser can host (GDD §14 — "mobile
   * one-slot planet"). Currently fixed at 1.
   */
  battlecruiserStructureSlotCount(): number;

  /**
   * Whether the Battlecruiser fires its own plasma bolt and intercepts LRW
   * shots from its hull. The May 2026 balance pass (issue #8) flipped this
   * to `false`: the cruiser is defenseless without a slotted weapon
   * platform (DefenseStation / OrbitalStrikePlatform / PointDefenseArray).
   * Kept as a config method so the policy is reversible without surgery.
   */
  battlecruiserHasDefaultWeapon(): boolean;

  /**
   * Long-range weapon damage applied to a ship directly when an OSP
   * hosted on a Battlecruiser shoots an enemy ship. Used in place of the
   * per-tile habitability damage when the LRW projectile impacts a unit
   * rather than a ground tile.
   */
  lrwShipDamage(): number;

  /**
   * Radius (tiles) of the heal aura emitted by a Foundry slotted on a
   * Battlecruiser. Same-owner ships within this distance receive
   * {@link foundryHealPerTick} HP per tick.
   */
  foundryHealRadius(): number;

  /**
   * Per-tick HP healed by a Battlecruiser-hosted Foundry on each
   * eligible same-owner ship in {@link foundryHealRadius}.
   */
  foundryHealPerTick(): number;

  // ---- Ticket 8: Habitability-gated structure slot limits -----------------
  /**
   * Maximum number of player structures a sector can host given the
   * placement tile's *effective* habitability (post any LRW damage).
   *   - hab ≤ 0.3 (AsteroidField): 0 — must terraform first.
   *   - habitable (Nebula / OpenSpace): uncapped (Number.POSITIVE_INFINITY)
   *     since the May 2026 balance pass (#1) removed the per-tier cap.
   * Returns 0 for negative or NaN inputs.
   */
  maxStructuresForHabitability(habitability: number): number;
}

export interface Theme {
  teamColor(team: Team): Colord;
  // Don't call directly, use PlayerView
  territoryColor(playerInfo: PlayerView): Colord;
  // Don't call directly, use PlayerView
  structureColors(territoryColor: Colord): { light: Colord; dark: Colord };
  // Don't call directly, use PlayerView
  borderColor(territoryColor: Colord): Colord;
  // Don't call directly, use PlayerView
  defendedBorderColors(territoryColor: Colord): { light: Colord; dark: Colord };
  focusedBorderColor(): Colord;
  terrainColor(gm: GameMap, tile: TileRef): Colord;
  backgroundColor(): Colord;
  falloutColor(): Colord;
  font(): string;
  textColor(playerInfo: PlayerView): string;
  // unit color for alternate view
  selfColor(): Colord;
  allyColor(): Colord;
  neutralColor(): Colord;
  enemyColor(): Colord;
  spawnHighlightColor(): Colord;
  spawnHighlightSelfColor(): Colord;
  spawnHighlightTeamColor(): Colord;
  spawnHighlightEnemyColor(): Colord;
}
