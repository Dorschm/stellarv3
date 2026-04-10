import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

/**
 * Characterization tests for the three core economy formulas in DefaultConfig:
 *   - maxTroops(player)
 *   - troopIncreaseRate(player)
 *   - creditAdditionRate(player)
 *
 * These tests intentionally lock in the *current* numeric behavior of each
 * formula so any upcoming GDD-driven refactor (habitability, volume, etc.)
 * will fail loudly instead of silently changing balance. Each assertion
 * pairs an exact formula re-derivation with a hardcoded "golden" magnitude
 * so both production drift and test-helper drift are detected.
 *
 * Map: "big_plains" (200x200, all sector tiles → 40,000 land tiles).
 */

const HUMAN_ID = "human_id";
const BOT_ID = "bot_id";
const NATION_ID = "nation_id";

const humanInfo = new PlayerInfo("human", PlayerType.Human, null, HUMAN_ID);
const botInfo = new PlayerInfo("bot", PlayerType.Bot, null, BOT_ID);
const nationInfo = new PlayerInfo("nation", PlayerType.Nation, null, NATION_ID);

function conquerTiles(game: Game, player: Player, count: number): void {
  const width = game.width();
  for (let i = 0; i < count; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    player.conquer(game.ref(x, y));
  }
}

describe("Economy formulas (characterization)", () => {
  describe("maxTroops", () => {
    let game: Game;

    beforeEach(async () => {
      game = await setup(
        "big_plains",
        {
          infiniteCredits: false,
          infiniteTroops: false,
          difficulty: Difficulty.Medium,
        },
        [humanInfo],
      );
    });

    test("Human with 1000 tiles and 0 colonies matches 2*(pow(tiles,0.6)*1000+50000)", () => {
      const player = game.player(HUMAN_ID);
      conquerTiles(game, player, 1000);
      expect(player.numTilesOwned()).toBe(1000);
      expect(player.units(UnitType.Colony)).toHaveLength(0);

      const expected = 2 * (Math.pow(1000, 0.6) * 1000 + 50000);
      const actual = game.config().maxTroops(player);

      // Exact re-derivation of the current formula.
      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~226,191 troops for 1000 tiles.
      expect(actual).toBeCloseTo(226191.47, 2);
    });

    test("Human with 5000 tiles adds colony contribution (level sum × 250,000)", () => {
      const player = game.player(HUMAN_ID);
      conquerTiles(game, player, 5000);
      expect(player.numTilesOwned()).toBe(5000);

      // Colony 1: stays at level 1. Colony 2: upgraded to level 2.
      // Sum of levels = 1 + 2 = 3, contributing 3 × 250,000 = 750,000.
      const colony1 = player.buildUnit(UnitType.Colony, game.ref(10, 10), {});
      const colony2 = player.buildUnit(UnitType.Colony, game.ref(40, 40), {});
      colony2.increaseLevel();
      expect(colony1.level()).toBe(1);
      expect(colony2.level()).toBe(2);

      const colonySum = 3;
      const colonyContribution =
        colonySum * game.config().colonyTroopIncrease();
      expect(colonyContribution).toBe(750_000);

      const expected =
        2 * (Math.pow(5000, 0.6) * 1000 + 50000) + colonyContribution;
      const actual = game.config().maxTroops(player);

      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~1,181,438 troops for 5000 tiles + colonies.
      expect(actual).toBeCloseTo(1181438.94, 2);
    });

    test("Bot with 1000 tiles applies ÷3 modifier", () => {
      game.addPlayer(botInfo);
      const bot = game.player(BOT_ID);
      conquerTiles(game, bot, 1000);
      expect(bot.numTilesOwned()).toBe(1000);

      const base = 2 * (Math.pow(1000, 0.6) * 1000 + 50000);
      const expected = base / 3;
      const actual = game.config().maxTroops(bot);

      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~75,397 troops for a 1000-tile bot.
      expect(actual).toBeCloseTo(75397.16, 2);
    });

    test("Nation (Medium difficulty) with 1000 tiles applies ×0.75 modifier", () => {
      game.addPlayer(nationInfo);
      const nation = game.player(NATION_ID);
      conquerTiles(game, nation, 1000);
      expect(nation.numTilesOwned()).toBe(1000);

      const base = 2 * (Math.pow(1000, 0.6) * 1000 + 50000);
      const expected = base * 0.75;
      const actual = game.config().maxTroops(nation);

      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~169,643 troops for a 1000-tile Medium nation.
      expect(actual).toBeCloseTo(169643.6, 1);
    });
  });

  describe("troopIncreaseRate", () => {
    let game: Game;

    beforeEach(async () => {
      game = await setup(
        "big_plains",
        {
          infiniteCredits: false,
          infiniteTroops: false,
          difficulty: Difficulty.Medium,
        },
        [humanInfo],
      );
    });

    test("Human with 25k troops and 1000 tiles matches formula (no type modifier)", () => {
      const player = game.player(HUMAN_ID);
      conquerTiles(game, player, 1000);
      player.setTroops(25_000);
      expect(player.troops()).toBe(25_000);

      const max = 2 * (Math.pow(1000, 0.6) * 1000 + 50000);
      const base = 10 + Math.pow(25_000, 0.73) / 4;
      const ratio = 1 - 25_000 / max;
      const rawToAdd = base * ratio;
      const expected = Math.min(25_000 + rawToAdd, max) - 25_000;
      const actual = game.config().troopIncreaseRate(player);

      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~370 troops/tick for this scenario.
      expect(actual).toBeCloseTo(370.57, 1);
    });

    test("Human near the soft cap produces growth approaching 0", () => {
      const player = game.player(HUMAN_ID);
      conquerTiles(game, player, 1000);
      const max = game.config().maxTroops(player);
      // Floor because setTroops stores a BigInt via toInt().
      player.setTroops(Math.floor(max));
      expect(player.troops()).toBe(Math.floor(max));

      const actual = game.config().troopIncreaseRate(player);
      // Ratio is (max - floor(max)) / max ~= 2e-6 → growth is effectively 0.
      expect(actual).toBeGreaterThanOrEqual(0);
      expect(actual).toBeLessThan(0.1);
      expect(actual).toBeCloseTo(0, 0);
    });

    test("Bot with 25k troops and 1000 tiles applies ×0.6 modifier on top of /3 cap", () => {
      game.addPlayer(botInfo);
      const bot = game.player(BOT_ID);
      conquerTiles(game, bot, 1000);
      bot.setTroops(25_000);

      const humanMax = 2 * (Math.pow(1000, 0.6) * 1000 + 50000);
      const botMax = humanMax / 3;
      const base = 10 + Math.pow(25_000, 0.73) / 4;
      const ratio = 1 - 25_000 / botMax;
      const rawToAdd = base * ratio * 0.6;
      const expected = Math.min(25_000 + rawToAdd, botMax) - 25_000;
      const actual = game.config().troopIncreaseRate(bot);

      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~167 troops/tick for this scenario.
      expect(actual).toBeCloseTo(167.1, 1);
    });

    test("Nation (Medium) with 25k troops and 1000 tiles applies ×0.95 modifier", () => {
      game.addPlayer(nationInfo);
      const nation = game.player(NATION_ID);
      conquerTiles(game, nation, 1000);
      nation.setTroops(25_000);

      const humanMax = 2 * (Math.pow(1000, 0.6) * 1000 + 50000);
      const nationMax = humanMax * 0.75; // Medium difficulty
      const base = 10 + Math.pow(25_000, 0.73) / 4;
      const ratio = 1 - 25_000 / nationMax;
      const rawToAdd = base * ratio * 0.95;
      const expected = Math.min(25_000 + rawToAdd, nationMax) - 25_000;
      const actual = game.config().troopIncreaseRate(nation);

      expect(actual).toBeCloseTo(expected, 6);
      // Golden magnitude: ~337 troops/tick for this scenario.
      expect(actual).toBeCloseTo(337.38, 1);
    });
  });

  describe("creditAdditionRate", () => {
    test("Human with default creditMultiplier returns 100n per tick", async () => {
      const game = await setup(
        "big_plains",
        { infiniteCredits: false, infiniteTroops: false },
        [humanInfo],
      );
      const player = game.player(HUMAN_ID);
      expect(game.config().creditMultiplier()).toBe(1);
      expect(game.config().creditAdditionRate(player)).toBe(100n);
    });

    test("Bot with default creditMultiplier returns 50n per tick", async () => {
      const game = await setup("big_plains", {
        infiniteCredits: false,
        infiniteTroops: false,
      });
      game.addPlayer(botInfo);
      const bot = game.player(BOT_ID);
      expect(game.config().creditMultiplier()).toBe(1);
      expect(game.config().creditAdditionRate(bot)).toBe(50n);
    });

    test("Human with creditMultiplier=2 returns 200n per tick", async () => {
      const game = await setup(
        "big_plains",
        {
          infiniteCredits: false,
          infiniteTroops: false,
          creditMultiplier: 2,
        },
        [humanInfo],
      );
      const player = game.player(HUMAN_ID);
      expect(game.config().creditMultiplier()).toBe(2);
      expect(game.config().creditAdditionRate(player)).toBe(200n);
    });

    test("Bot with creditMultiplier=2 returns 100n per tick", async () => {
      const game = await setup("big_plains", {
        infiniteCredits: false,
        infiniteTroops: false,
        creditMultiplier: 2,
      });
      game.addPlayer(botInfo);
      const bot = game.player(BOT_ID);
      expect(game.config().creditMultiplier()).toBe(2);
      expect(game.config().creditAdditionRate(bot)).toBe(100n);
    });
  });
});
