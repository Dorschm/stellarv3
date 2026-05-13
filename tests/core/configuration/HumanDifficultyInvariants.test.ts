// @vitest-environment node
import { describe, expect, test } from "vitest";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";
import { Difficulty, Player, PlayerType } from "../../../src/core/game/Game";
import { PlayerView } from "../../../src/core/game/GameView";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { TestServerConfig } from "../../util/TestServerConfig";

/**
 * Regression guard for the May 2026 difficulty audit (issue #2).
 *
 * The audit (see docs/difficulty-audit-2026-05.md) verified that every
 * difficulty-scaled value influences only AI Nations / Bots, never humans.
 * This test pins that invariant: for a `PlayerType.Human` player, the four
 * core economic outputs must be identical across all four `Difficulty`
 * values. Any future change that breaks this fails the test loudly.
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

/**
 * Build a minimal Human-typed Player stub. The audited methods only read
 * `type()`, `population()`, `numTilesOwned()`, and `units()` — we hand-roll
 * just enough for the difficulty branches to be exercised.
 */
function makeHuman(populationValue: number): Player {
  return {
    type: () => PlayerType.Human,
    population: () => populationValue,
    numTilesOwned: () => 100,
    units: () => [],
  } as unknown as Player;
}

const ALL_DIFFICULTIES: Difficulty[] = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];

describe("Human economy is difficulty-invariant", () => {
  test("maxPopulation is identical across all difficulties", () => {
    const human = makeHuman(50_000);
    const values = ALL_DIFFICULTIES.map((d) =>
      makeConfig(d).maxPopulation(human as Player | PlayerView),
    );
    for (const v of values) expect(v).toBe(values[0]);
  });

  test("troopIncreaseRate is identical across all difficulties", () => {
    const human = makeHuman(50_000);
    const values = ALL_DIFFICULTIES.map((d) =>
      makeConfig(d).troopIncreaseRate(human),
    );
    for (const v of values) expect(v).toBe(values[0]);
  });

  test("creditAdditionRate is identical across all difficulties", () => {
    const human = makeHuman(50_000);
    const values = ALL_DIFFICULTIES.map((d) =>
      makeConfig(d).creditAdditionRate(human),
    );
    for (const v of values) expect(v).toBe(values[0]);
  });

  test("fleet upkeep scaling is identical across all difficulties", () => {
    const human = makeHuman(50_000);
    for (const fn of [
      "assaultShuttleUpkeepPerTick",
      "battlecruiserUpkeepPerTick",
      "tradeFreighterUpkeepPerTick",
    ] as const) {
      const values = ALL_DIFFICULTIES.map((d) => makeConfig(d)[fn](human));
      for (const v of values) expect(v).toBe(values[0]);
    }
  });
});
