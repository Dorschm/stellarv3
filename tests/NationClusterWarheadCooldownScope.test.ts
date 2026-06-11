import { NationClusterWarheadBehavior } from "../src/core/execution/nation/NationClusterWarheadBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { Game, Player } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";

// Regression test: the shared MIRV pile-on cooldown must be scoped per Game
// instance. A process that hosts several games over its lifetime (tests,
// reused client worker) must not carry "recently MIRVed" state from one game
// into the next — a fresh game has to start clean.
describe("NationClusterWarheadBehavior MIRV cooldown scoping", () => {
  function mockGame(): Game {
    return { ticks: () => 100 } as unknown as Game;
  }

  function mockPlayer(id: string): Player {
    return { id: () => id } as unknown as Player;
  }

  function makeBehavior(game: Game): NationClusterWarheadBehavior {
    const random = new PseudoRandom(1);
    const player = mockPlayer("nation_id");
    return new NationClusterWarheadBehavior(
      random,
      game,
      player,
      new NationEmojiBehavior(random, game, player),
    );
  }

  test("cooldown is shared between nations within the same game", () => {
    const game = mockGame();
    const target = mockPlayer("target_id");

    const behaviorA = makeBehavior(game);
    const behaviorB = makeBehavior(game);

    (behaviorA as any).recordMirvHit(target);

    expect((behaviorA as any).wasRecentlyMirved(target)).toBe(true);
    expect((behaviorB as any).wasRecentlyMirved(target)).toBe(true);
  });

  test("cooldown never leaks into a different game", () => {
    const gameA = mockGame();
    const gameB = mockGame();
    const target = mockPlayer("target_id");

    const behaviorA = makeBehavior(gameA);
    (behaviorA as any).recordMirvHit(target);
    expect((behaviorA as any).wasRecentlyMirved(target)).toBe(true);

    const behaviorB = makeBehavior(gameB);
    expect((behaviorB as any).wasRecentlyMirved(target)).toBe(false);
  });
});
