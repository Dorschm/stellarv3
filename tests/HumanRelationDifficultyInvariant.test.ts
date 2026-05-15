// @vitest-environment node
import { describe, expect, test } from "vitest";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { DonateCreditsExecution } from "../src/core/execution/DonateCreditsExecution";
import { Difficulty, Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

/**
 * Regression guard for the May 2026 difficulty audit (issue #2).
 *
 * Two difficulty-scaled values that were previously assumed to be
 * Nation-only consumers are in fact human-visible via
 * {@link import("../src/core/game/PlayerImpl").PlayerImpl.playerProfile} —
 * which is rendered by {@link PlayerPanel}:
 *
 *   1. `AttackExecution` relation delta (Easy −60 → Impossible −100).
 *   2. `DonateCreditsExecution.getCreditsChunkSize` (Easy 2 500 → Impossible
 *      25 000), which determines how many relation points a given credit
 *      donation produces.
 *
 * Both are now normalized to the Hard tier whenever a human is on either
 * side of the interaction. This test pins that invariant for the two
 * Human↔Nation paths the audit calls out.
 *
 * See {@link file://./docs/difficulty-audit-2026-05.md}.
 */

const ALL_DIFFICULTIES: Difficulty[] = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];

const HARD_ATTACK_DELTA = -80;
const HARD_DONATION_CHUNK_SIZE = 12_500;

async function makeHumanNationGame(difficulty: Difficulty): Promise<{
  game: Game;
  human: Player;
  nation: Player;
}> {
  const game = await setup(
    "plains",
    {
      difficulty,
      infiniteCredits: true,
      instantBuild: true,
      infinitePopulation: true,
    },
    [
      playerInfo("human_actor", PlayerType.Human),
      playerInfo("nation_actor", PlayerType.Nation),
    ],
  );
  const human = game.player("human_actor");
  const nation = game.player("nation_actor");
  human.conquer(game.ref(0, 0));
  nation.conquer(game.ref(0, 1));
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  return { game, human, nation };
}

function rawRelation(target: Player, source: Player): number {
  // `Player.relation()` returns the bucketed `Relation` enum, which would
  // hide differences inside the same bucket (e.g. −60 vs −100 are both
  // Hostile). Read the raw stored number directly so we pin the exact
  // delta the execution applied.
  const relations = (target as unknown as { relations: Map<Player, number> })
    .relations;
  return relations.get(source) ?? 0;
}

describe("Human↔Nation relation deltas are difficulty-invariant", () => {
  test("AttackExecution applies the same relation delta across all difficulties (human attacker)", async () => {
    const deltas: number[] = [];
    for (const difficulty of ALL_DIFFICULTIES) {
      const { game, human, nation } = await makeHumanNationGame(difficulty);
      game.addExecution(new AttackExecution(100, human, nation.id()));
      // AttackExecution.init() runs on the next tick and applies the
      // relation delta. One tick is enough; we don't need the attack to
      // actually resolve.
      game.executeNextTick();
      deltas.push(rawRelation(nation, human));
    }
    for (const d of deltas) expect(d).toBe(deltas[0]);
    expect(deltas[0]).toBe(HARD_ATTACK_DELTA);
  });

  test("AttackExecution applies the same relation delta across all difficulties (nation attacker)", async () => {
    const deltas: number[] = [];
    for (const difficulty of ALL_DIFFICULTIES) {
      const { game, human, nation } = await makeHumanNationGame(difficulty);
      game.addExecution(new AttackExecution(100, nation, human.id()));
      game.executeNextTick();
      deltas.push(rawRelation(human, nation));
    }
    for (const d of deltas) expect(d).toBe(deltas[0]);
    expect(deltas[0]).toBe(HARD_ATTACK_DELTA);
  });

  test("DonateCreditsExecution.getCreditsChunkSize is identical across all difficulties (human → nation)", async () => {
    const chunkSizes: number[] = [];
    for (const difficulty of ALL_DIFFICULTIES) {
      const { game, human, nation } = await makeHumanNationGame(difficulty);

      // Build a DonateCreditsExecution with the production constructor and
      // run init() so it resolves `recipient` from the game state, then
      // pull the chunk size directly. We deliberately avoid running tick()
      // here — tick() requires a friendly relationship between sender and
      // recipient (canDonateCredits), and the audit invariant is about the
      // chunk size itself, not the alliance gate.
      const exec = new DonateCreditsExecution(human, nation.id(), 100_000);
      exec.init(game, game.ticks());
      const chunkSize = (
        exec as unknown as { getCreditsChunkSize: () => number }
      ).getCreditsChunkSize();
      chunkSizes.push(chunkSize);
    }
    for (const c of chunkSizes) expect(c).toBe(chunkSizes[0]);
    expect(chunkSizes[0]).toBe(HARD_DONATION_CHUNK_SIZE);
  });
});
