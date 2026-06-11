import { respondToMIRV } from "../src/core/execution/nation/NationEmojiBehavior";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";

// Regression test: respondToMIRV is AI flavor — it must never make a HUMAN
// MIRV target broadcast an emoji they didn't send (which also burned their
// real emoji cooldown). Only nation-controlled players auto-emote.
describe("respondToMIRV player-type guard", () => {
  function mockTarget(type: PlayerType): Player {
    return {
      type: () => type,
      canSendEmoji: () => true,
      id: () => "target_id",
    } as unknown as Player;
  }

  test("never emotes on behalf of a human target", () => {
    const game = { addExecution: vi.fn() } as unknown as Game;
    const random = new PseudoRandom(1);
    const human = mockTarget(PlayerType.Human);

    // The emoji fires with 1-in-8 probability; enough attempts that the
    // unguarded version would certainly have emoted at least once.
    for (let i = 0; i < 100; i++) {
      respondToMIRV(game, random, human);
    }

    expect(game.addExecution).not.toHaveBeenCalled();
  });

  test("still emotes for a nation target", () => {
    const game = { addExecution: vi.fn() } as unknown as Game;
    const random = new PseudoRandom(1);
    const nation = mockTarget(PlayerType.Nation);

    for (let i = 0; i < 100; i++) {
      respondToMIRV(game, random, nation);
    }

    expect(game.addExecution).toHaveBeenCalled();
  });
});
