import { JWK } from "jose";
import { z } from "zod";
import {
  Credits,
  Difficulty,
  Game,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, GameID, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, simpleHash, toInt, within } from "../Util";
import { Config, GameEnv, NukeMagnitude, ServerConfig, Theme } from "./Config";
import { Env } from "./Env";
import { PastelTheme } from "./PastelTheme";
import { PastelThemeDark } from "./PastelThemeDark";

const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

export abstract class DefaultServerConfig implements ServerConfig {
  turnstileSecretKey(): string {
    return Env.TURNSTILE_SECRET_KEY ?? "";
  }
  abstract turnstileSiteKey(): string;
  allowedFlares(): string[] | undefined {
    return;
  }
  stripePublishableKey(): string {
    return Env.STRIPE_PUBLISHABLE_KEY ?? "";
  }
  domain(): string {
    return Env.DOMAIN ?? "";
  }
  subdomain(): string {
    return Env.SUBDOMAIN ?? "";
  }

  private publicKey: JWK;
  abstract jwtAudience(): string;
  jwtIssuer(): string {
    const audience = this.jwtAudience();
    return audience === "localhost"
      ? "http://localhost:8787"
      : `https://api.${audience}`;
  }
  async jwkPublicKey(): Promise<JWK> {
    if (this.publicKey) return this.publicKey;
    const jwksUrl = this.jwtIssuer() + "/.well-known/jwks.json";
    console.log(`Fetching JWKS from ${jwksUrl}`);
    const response = await fetch(jwksUrl);
    const result = JwksSchema.safeParse(await response.json());
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Error parsing JWKS", error);
      throw new Error("Invalid JWKS");
    }
    this.publicKey = result.data.keys[0];
    return this.publicKey;
  }
  otelEnabled(): boolean {
    return (
      this.env() !== GameEnv.Dev &&
      Boolean(this.otelEndpoint()) &&
      Boolean(this.otelAuthHeader())
    );
  }
  otelEndpoint(): string {
    return Env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "";
  }
  otelAuthHeader(): string {
    return Env.OTEL_AUTH_HEADER ?? "";
  }
  gitCommit(): string {
    return Env.GIT_COMMIT ?? "";
  }

  apiKey(): string {
    return Env.API_KEY ?? "";
  }

  adminHeader(): string {
    return "x-admin-key";
  }
  adminToken(): string {
    const token = Env.ADMIN_TOKEN;
    if (!token) {
      throw new Error("ADMIN_TOKEN not set");
    }
    return token;
  }
  abstract numWorkers(): number;
  abstract env(): GameEnv;
  turnIntervalMs(): number {
    return 100;
  }
  gameCreationRate(): number {
    return 2 * 60 * 1000;
  }

  workerIndex(gameID: GameID): number {
    return simpleHash(gameID) % this.numWorkers();
  }
  workerPath(gameID: GameID): string {
    return `w${this.workerIndex(gameID)}`;
  }
  workerPort(gameID: GameID): number {
    return this.workerPortByIndex(this.workerIndex(gameID));
  }
  workerPortByIndex(index: number): number {
    return 3001 + index;
  }
}

/** Point defense array construction duration in ticks (non-instant-build). */
export const POINT_DEFENSE_CONSTRUCTION_TICKS = 30 * 10;

export class DefaultConfig implements Config {
  private pastelTheme: PastelTheme = new PastelTheme();
  private pastelThemeDark: PastelThemeDark = new PastelThemeDark();
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    private _serverConfig: ServerConfig,
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
  ) {}

  stripePublishableKey(): string {
    return Env.STRIPE_PUBLISHABLE_KEY ?? "";
  }

  isReplay(): boolean {
    return this._isReplay;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  serverConfig(): ServerConfig {
    return this._serverConfig;
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  colonyTroopIncrease(): number {
    return 250_000;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }
  pointDefenseCooldown(): number {
    return 120;
  }
  orbitalStrikeCooldown(): number {
    return 75;
  }

  defenseStationRange(): number {
    return 30;
  }

  defenseStationDefenseBonus(): number {
    return 5;
  }

  defenseStationSpeedBonus(): number {
    return 3;
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    return this._gameConfig.disableAlliances ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteCredits(): boolean {
    return this._gameConfig.infiniteCredits;
  }
  donateCredits(): boolean {
    return this._gameConfig.donateCredits;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  creditMultiplier(): number {
    return this._gameConfig.creditMultiplier ?? 1;
  }
  startingCredits(playerInfo: PlayerInfo): Credits {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return BigInt(this._gameConfig.startingCredits ?? 0);
  }

  frigateSpawnRate(numPlayerFoundries: number): number {
    // hyperbolic decay, midpoint at 10 foundries
    // expected number of frigates = numPlayerFoundries  / frigateSpawnRate(numPlayerFoundries)
    return (numPlayerFoundries + 10) * 15;
  }
  frigateCredits(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
  ): Credits {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseCredits: number;
    switch (rel) {
      case "ally":
        baseCredits = 35_000;
        break;
      case "team":
      case "other":
        baseCredits = 25_000;
        break;
      case "self":
        baseCredits = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const credits = Math.max(5000, baseCredits - distPenalty);
    return toInt(credits * this.creditMultiplier());
  }

  tradeHubMinRange(): number {
    return 15;
  }
  tradeHubMaxRange(): number {
    return 100;
  }
  hyperspaceLaneMaxSize(): number {
    return 120;
  }

  tradeFreighterCredits(dist: number): Credits {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    const debuff = this.tradeFreighterShortRangeDebuff();
    const baseCredits =
      75_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 50 * dist;
    const multiplier = this.creditMultiplier();
    return BigInt(Math.floor(baseCredits * multiplier));
  }

  // Probability of trade freighter spawn = 1 / tradeFreighterSpawnRate
  tradeFreighterSpawnRate(
    tradeFreighterSpawnRejections: number,
    numTradeFreighters: number,
  ): number {
    const decayRate = Math.LN2 / 50;

    // Approaches 0 as numTradeFreighters increase
    const baseSpawnRate = 1 - sigmoid(numTradeFreighters, decayRate, 200);

    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeFreighterSpawnRejections + 1);

    return Math.floor((100 * rejectionModifier) / baseSpawnRate);
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.AssaultShuttle:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Battlecruiser:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Battlecruiser,
          ),
          maxHealth: 1000,
        };
        break;
      case UnitType.PlasmaBolt:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.PointDefenseMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Spaceport:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Spaceport,
            UnitType.Foundry,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.AntimatterTorpedo:
        info = {
          cost: this.costWrapper(() => 750_000, UnitType.AntimatterTorpedo),
        };
        break;
      case UnitType.NovaBomb:
        info = {
          cost: this.costWrapper(() => 5_000_000, UnitType.NovaBomb),
        };
        break;
      case UnitType.ClusterWarhead:
        info = {
          cost: (game: Game, player: Player) => {
            if (player.type() === PlayerType.Human && this.infiniteCredits()) {
              return 0n;
            }
            return (
              25_000_000n +
              game.stats().numClusterWarheadsLaunched() * 15_000_000n
            );
          },
        };
        break;
      case UnitType.ClusterWarheadSubmunition:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeFreighter:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.OrbitalStrikePlatform:
        info = {
          cost: this.costWrapper(
            () => 1_000_000,
            UnitType.OrbitalStrikePlatform,
          ),
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
        break;
      case UnitType.DefenseStation:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(250_000, (numUnits + 1) * 50_000),
            UnitType.DefenseStation,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
        };
        break;
      case UnitType.PointDefenseArray:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.PointDefenseArray,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : POINT_DEFENSE_CONSTRUCTION_TICKS,
          upgradable: true,
        };
        break;
      case UnitType.Colony:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Colony,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Foundry:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Foundry,
            UnitType.Spaceport,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Frigate:
        info = {
          cost: () => 0n,
        };
        break;
      default:
        assertNever(type);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      if (player.type() === PlayerType.Human && this.infiniteCredits()) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits));
    };
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  shuttleMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.AssaultShuttle)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 300;
  }
  numBots(): number {
    return this.bots();
  }
  theme(): Theme {
    return this.userSettings()?.darkMode()
      ? this.pastelThemeDark
      : this.pastelTheme;
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag = 0;
    let speed = 0;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.OpenSpace:
        mag = 80;
        speed = 16.5;
        break;
      case TerrainType.Nebula:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.AsteroidField:
        mag = 120;
        speed = 25;
        break;
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    if (defender.isPlayer()) {
      for (const dp of gm.nearbyUnits(
        tileToConquer,
        gm.config().defenseStationRange(),
        UnitType.DefenseStation,
      )) {
        if (dp.unit.owner() === defender) {
          mag *= this.defenseStationDefenseBonus();
          speed *= this.defenseStationSpeedBonus();
          break;
        }
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numSectorTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (defender.isDisconnected() && attacker.isOnSameTeam(defender)) {
        // No troop loss if defender is disconnected and on same team
        mag = 0;
      }
      if (
        attacker.type() === PlayerType.Human &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.8;
      }
      if (
        attacker.type() === PlayerType.Nation &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.8;
      }
    }

    if (defender.isPlayer()) {
      const defenseSig =
        1 -
        sigmoid(
          defender.numTilesOwned(),
          DEFENSE_DEBUFF_DECAY_RATE,
          DEFENSE_DEBUFF_MIDPOINT,
        );

      const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
      const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

      let largeAttackBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackBonus = Math.sqrt(100_000 / attacker.numTilesOwned()) ** 0.7;
      }
      let largeAttackerSpeedBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackerSpeedBonus = (100_000 / attacker.numTilesOwned()) ** 0.6;
      }

      const defenderTroopLoss = defender.troops() / defender.numTilesOwned();
      const traitorMod = defender.isTraitor() ? this.traitorDefenseDebuff() : 1;
      const currentAttackerLoss =
        within(defender.troops() / attackTroops, 0.6, 2) *
        mag *
        0.8 *
        largeDefenderAttackDebuff *
        largeAttackBonus *
        traitorMod;
      const altAttackerLoss =
        1.3 * defenderTroopLoss * (mag / 100) * traitorMod;
      const attackerTroopLoss =
        0.7 * currentAttackerLoss + 0.3 * altAttackerLoss;

      return {
        attackerTroopLoss,
        defenderTroopLoss,
        tilesPerTickUsed:
          within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
          speed *
          largeDefenderSpeedDebuff *
          largeAttackerSpeedBonus *
          (defender.isTraitor() ? this.traitorSpeedDebuff() : 1),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() === PlayerType.Bot ? mag / 10 : mag / 5,
        defenderTroopLoss: 0,
        tilesPerTickUsed: within(
          (2000 * Math.max(10, speed)) / attackTroops,
          5,
          100,
        ),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3
      );
    } else {
      return numAdjacentTilesWithEnemy * 2;
    }
  }

  shuttleAttackAmount(
    attacker: Player,
    defender: Player | TerraNullius,
  ): number {
    return Math.floor(attacker.troops() / 5);
  }

  battlecruiserPlasmaBoltLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusSpaceportSpawn() {
    return 20;
  }

  tradeFreighterShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusSpaceportsNb(totalSpaceports: number) {
    return within(totalSpaceports / 3, 4, totalSpaceports);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    return this.infiniteTroops() ? 1_000_000 : 25_000;
  }

  maxTroops(player: Player | PlayerView): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.infiniteTroops()
        ? 1_000_000_000
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
          player
            .units(UnitType.Colony)
            .map((colony) => colony.level())
            .reduce((a, b) => a + b, 0) *
            this.colonyTroopIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxTroops / 3;
    }

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  troopIncreaseRate(player: Player): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + Math.pow(player.troops(), 0.73) / 4;

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.6;
    }

    if (player.type() === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          toAdd *= 1; // Like humans
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }

    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  creditAdditionRate(player: Player): Credits {
    const multiplier = this.creditMultiplier();
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(Math.floor(Number(baseRate) * multiplier));
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.ClusterWarheadSubmunition:
        return { inner: 12, outer: 18 };
      case UnitType.AntimatterTorpedo:
        return { inner: 12, outer: 30 };
      case UnitType.NovaBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  defaultNukeSpeed(): number {
    return 6;
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultPointDefenseRange(): number {
    return 70;
  }

  pointDefenseRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above nova bomb range, asymptotically approaches 150)
    return this.maxPointDefenseRange() - 480 / (level + 5);
  }

  maxPointDefenseRange(): number {
    return 150;
  }

  defaultPointDefenseMissileSpeed(): number {
    return 12;
  }

  // Humans can be soldiers, soldiers attacking, soldiers in shuttle etc.
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.ClusterWarheadSubmunition) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - Math.exp(-steepness * normalizedExcess));
  }

  structureMinDist(): number {
    return 15;
  }

  plasmaBoltLifetime(): number {
    return 50;
  }

  battlecruiserPatrolRange(): number {
    return 100;
  }

  battlecruiserTargettingRange(): number {
    return 130;
  }

  battlecruiserPlasmaBoltAttackRate(): number {
    return 20;
  }

  defenseStationPlasmaBoltAttackRate(): number {
    return 100;
  }

  safeFromRaidersCooldownMax(): number {
    return 20;
  }

  defenseStationTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}
