import { DonateCreditsExecution } from "../src/core/execution/DonateCreditsExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

/**
 * Regression test: a donate_credits intent with `credits: null` (allowed by
 * DonateCreditsIntentSchema) must fall back to the default donation of one
 * third of the sender's balance. The constructor used to coerce null to 0n,
 * making the `this.credits ??= sender.credits() / 3n` fallback in init()
 * dead code and the donation a silent no-op.
 */
describe("Donate credits with null amount", () => {
  it("donates one third of the sender's balance by default", async () => {
    const game = await setup("ocean_and_land", {
      infiniteCredits: false,
      donateCredits: true,
    });
    const gameID: GameID = "game_id";

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    game.addExecution(
      new SpawnExecution(gameID, donorInfo, game.ref(0, 10)),
      new SpawnExecution(gameID, recipientInfo, game.ref(0, 15)),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();
    allianceRequest!.accept();
    game.executeNextTick();

    // Pin the donor's balance so the one-third default is unambiguous.
    // The execution is driven manually (init + tick) so the free-running
    // economy can't change either balance between snapshot and assert.
    donor.removeCredits(donor.credits());
    donor.addCredits(9000n);
    const recipientBefore = recipient.credits();

    const exec = new DonateCreditsExecution(donor, recipientInfo.id, null);
    exec.init(game, game.ticks());
    exec.tick(game.ticks());

    expect(donor.credits()).toBe(6000n);
    expect(recipient.credits()).toBe(recipientBefore + 3000n);
    expect(exec.isActive()).toBe(false);
  });
});
