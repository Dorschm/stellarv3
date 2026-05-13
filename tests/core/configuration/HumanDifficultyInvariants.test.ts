// @vitest-environment node
import { beforeAll, describe, expect, test } from "vitest";
import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

/**
 * Regression guard for plans/here-is-a-list-twinkly-dragonfly.md §3.3.
 *
 * Every per-Difficulty branch in `DefaultConfig` and execution code must
 * be gated on `PlayerType.Nation` (or `Bot`) — never on Human. These
 * tests build four parallel games at Easy/Medium/Hard/Impossible, give
 * the same Human player the same territory and population in each, and
 * assert the human-relevant Config methods return identical values
 * across all four. Any new code path that scales a human stat by
 * difficulty will regress one of these assertions.
 */

const HUMAN_ID = "human_id";
const humanInfo = new PlayerInfo("human", PlayerType.Human, null, HUMAN_ID);

function conquerTiles(game: Game, player: Player, count: number): void {
  const width = game.width();
  for (let i = 0; i < count; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    player.conquer(game.ref(x, y));
  }
}

interface HumanSnapshot {
  maxPopulation: number;
  troopIncreaseRate: number;
  creditAdditionRate: bigint;
  shuttleUpkeep: bigint;
  cruiserUpkeep: bigint;
  freighterUpkeep: bigint;
}

async function snapshotHuman(difficulty: Difficulty): Promise<HumanSnapshot> {
  const game = await setup(
    "big_plains",
    { infiniteCredits: false, infinitePopulation: false, difficulty },
    [humanInfo],
  );
  const player = game.player(HUMAN_ID);
  conquerTiles(game, player, 1000);
  player.setPopulation(50_000);
  const c = game.config();
  return {
    maxPopulation: c.maxPopulation(player),
    troopIncreaseRate: c.troopIncreaseRate(player),
    creditAdditionRate: c.creditAdditionRate(player),
    shuttleUpkeep: c.assaultShuttleUpkeepPerTick(player),
    cruiserUpkeep: c.battlecruiserUpkeepPerTick(player),
    freighterUpkeep: c.tradeFreighterUpkeepPerTick(player),
  };
}

describe("Human player has no per-difficulty handicap", () => {
  let easy: HumanSnapshot;
  let medium: HumanSnapshot;
  let hard: HumanSnapshot;
  let impossible: HumanSnapshot;

  beforeAll(async () => {
    easy = await snapshotHuman(Difficulty.Easy);
    medium = await snapshotHuman(Difficulty.Medium);
    hard = await snapshotHuman(Difficulty.Hard);
    impossible = await snapshotHuman(Difficulty.Impossible);
  });

  test("maxPopulation is identical across all four difficulties", () => {
    expect(medium.maxPopulation).toBe(easy.maxPopulation);
    expect(hard.maxPopulation).toBe(easy.maxPopulation);
    expect(impossible.maxPopulation).toBe(easy.maxPopulation);
  });

  test("troopIncreaseRate is identical across all four difficulties", () => {
    expect(medium.troopIncreaseRate).toBeCloseTo(easy.troopIncreaseRate, 6);
    expect(hard.troopIncreaseRate).toBeCloseTo(easy.troopIncreaseRate, 6);
    expect(impossible.troopIncreaseRate).toBeCloseTo(
      easy.troopIncreaseRate,
      6,
    );
  });

  test("creditAdditionRate is identical across all four difficulties", () => {
    expect(medium.creditAdditionRate).toBe(easy.creditAdditionRate);
    expect(hard.creditAdditionRate).toBe(easy.creditAdditionRate);
    expect(impossible.creditAdditionRate).toBe(easy.creditAdditionRate);
  });

  test("fleet upkeep rates are identical across all four difficulties", () => {
    expect(medium.shuttleUpkeep).toBe(easy.shuttleUpkeep);
    expect(hard.shuttleUpkeep).toBe(easy.shuttleUpkeep);
    expect(impossible.shuttleUpkeep).toBe(easy.shuttleUpkeep);

    expect(medium.cruiserUpkeep).toBe(easy.cruiserUpkeep);
    expect(hard.cruiserUpkeep).toBe(easy.cruiserUpkeep);
    expect(impossible.cruiserUpkeep).toBe(easy.cruiserUpkeep);

    expect(medium.freighterUpkeep).toBe(easy.freighterUpkeep);
    expect(hard.freighterUpkeep).toBe(easy.freighterUpkeep);
    expect(impossible.freighterUpkeep).toBe(easy.freighterUpkeep);
  });
});
