// @vitest-environment node
import { describe, expect, test } from "vitest";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";
import { Difficulty, Player, PlayerType } from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { TestServerConfig } from "../../util/TestServerConfig";

/**
 * GDD §3.2 — fleet-upkeep scaling. These tests pin the Bot/Nation
 * multiplier pattern so Easy bots pay less than Humans and higher-
 * difficulty Nations pay progressively more. The scaling helper runs in
 * bigint space on the upkeep hot path, so we assert exact integer ratios
 * rather than fuzzy float deltas.
 */

function makeConfig(difficulty: Difficulty): DefaultConfig {
  const gameConfig: GameConfig = {
    gameMap: "SolSystem" as any,
    gameMapSize: "Normal" as any,
    gameMode: "FFA" as any,
    gameType: "Singleplayer" as any,
    difficulty,
    nations: "default",
    donateCredits: false,
    donatePopulation: false,
    bots: 0,
    infiniteCredits: false,
    infinitePopulation: false,
    instantBuild: true,
    randomSpawn: false,
  };
  return new DefaultConfig(
    new TestServerConfig(),
    gameConfig,
    new UserSettings(),
    false,
  );
}

function makeOwner(type: PlayerType): Player {
  return { type: () => type } as unknown as Player;
}

describe("fleet upkeep — owner-aware scaling", () => {
  test("Human owner pays the flat base rate", () => {
    const config = makeConfig(Difficulty.Medium);
    const human = makeOwner(PlayerType.Human);

    // Base rates are 50 / 100 / 10 (see DefaultConfig module constants).
    expect(config.assaultShuttleUpkeepPerTick(human)).toBe(50n);
    expect(config.battlecruiserUpkeepPerTick(human)).toBe(100n);
    expect(config.tradeFreighterUpkeepPerTick(human)).toBe(10n);
  });

  test("Bot upkeep is strictly less than Human upkeep (×0.6)", () => {
    const config = makeConfig(Difficulty.Medium);
    const human = makeOwner(PlayerType.Human);
    const bot = makeOwner(PlayerType.Bot);

    const humanShuttle = config.assaultShuttleUpkeepPerTick(human);
    const botShuttle = config.assaultShuttleUpkeepPerTick(bot);
    expect(botShuttle).toBeLessThan(humanShuttle);
    expect(botShuttle).toBe((50n * 60n) / 100n);

    const humanCruiser = config.battlecruiserUpkeepPerTick(human);
    const botCruiser = config.battlecruiserUpkeepPerTick(bot);
    expect(botCruiser).toBeLessThan(humanCruiser);
    expect(botCruiser).toBe((100n * 60n) / 100n);

    const humanFreighter = config.tradeFreighterUpkeepPerTick(human);
    const botFreighter = config.tradeFreighterUpkeepPerTick(bot);
    expect(botFreighter).toBeLessThan(humanFreighter);
    expect(botFreighter).toBe((10n * 60n) / 100n);
  });

  test("Easy Nation upkeep is below Human upkeep (×0.9)", () => {
    const config = makeConfig(Difficulty.Easy);
    const human = makeOwner(PlayerType.Human);
    const nation = makeOwner(PlayerType.Nation);

    expect(config.battlecruiserUpkeepPerTick(nation)).toBeLessThan(
      config.battlecruiserUpkeepPerTick(human),
    );
    expect(config.battlecruiserUpkeepPerTick(nation)).toBe((100n * 90n) / 100n);
  });

  test("Hard Nation upkeep is >= Human upkeep (×1.0)", () => {
    const config = makeConfig(Difficulty.Hard);
    const human = makeOwner(PlayerType.Human);
    const nation = makeOwner(PlayerType.Nation);

    expect(config.assaultShuttleUpkeepPerTick(nation)).toBeGreaterThanOrEqual(
      config.assaultShuttleUpkeepPerTick(human),
    );
    expect(config.battlecruiserUpkeepPerTick(nation)).toBeGreaterThanOrEqual(
      config.battlecruiserUpkeepPerTick(human),
    );
    expect(config.tradeFreighterUpkeepPerTick(nation)).toBeGreaterThanOrEqual(
      config.tradeFreighterUpkeepPerTick(human),
    );
  });

  test("Impossible Nation upkeep strictly exceeds Human upkeep (×1.05)", () => {
    const config = makeConfig(Difficulty.Impossible);
    const human = makeOwner(PlayerType.Human);
    const nation = makeOwner(PlayerType.Nation);

    expect(config.battlecruiserUpkeepPerTick(nation)).toBeGreaterThan(
      config.battlecruiserUpkeepPerTick(human),
    );
    expect(config.battlecruiserUpkeepPerTick(nation)).toBe(
      (100n * 105n) / 100n,
    );
  });

  test("omitting the owner returns the unscaled base rate", () => {
    const config = makeConfig(Difficulty.Medium);
    expect(config.assaultShuttleUpkeepPerTick()).toBe(50n);
    expect(config.battlecruiserUpkeepPerTick()).toBe(100n);
    expect(config.tradeFreighterUpkeepPerTick()).toBe(10n);
  });
});
