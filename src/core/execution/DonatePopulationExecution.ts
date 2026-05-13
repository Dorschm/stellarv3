import {
  Execution,
  Game,
  Player,
  PlayerID,
  PlayerType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { EmojiExecution } from "./EmojiExecution";
import {
  EMOJI_DONATION_TOO_SMALL,
  EMOJI_LOVE,
} from "./nation/NationEmojiBehavior";

export class DonatePopulationExecution implements Execution {
  private recipient: Player;

  private random: PseudoRandom;
  private mg: Game;

  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private population: number | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonatePopulationExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.population ??= mg.config().defaultDonationAmount(this.sender);
    const maxDonation =
      mg.config().maxPopulation(this.recipient) - this.recipient.population();
    this.population = Math.min(this.population, maxDonation);
  }

  tick(ticks: number): void {
    if (this.population === null) throw new Error("not initialized");

    const minPopulation = this.getMinPopulationForRelationUpdate();

    if (
      this.sender.canDonatePopulation(this.recipient) &&
      this.sender.donatePopulation(this.recipient, this.population)
    ) {
      // Prevent players from just buying a good relation by sending 1% population. Instead, a minimum is needed, and it's random.
      if (this.population >= minPopulation) {
        this.recipient.updateRelation(this.sender, 50);
      }

      // Only AI nations auto-respond with emojis, human players should not
      if (
        this.recipient.type() === PlayerType.Nation &&
        this.recipient.canSendEmoji(this.sender)
      ) {
        this.mg.addExecution(
          new EmojiExecution(
            this.recipient,
            this.sender.id(),
            this.random.randElement(
              this.population >= minPopulation
                ? EMOJI_LOVE
                : EMOJI_DONATION_TOO_SMALL,
            ),
          ),
        );
      }
    } else {
      console.warn(
        `cannot send population from ${this.sender} to ${this.recipient}`,
      );
    }
    this.active = false;
  }

  private getMinPopulationForRelationUpdate(): number {
    // Per locked decision (plans/here-is-a-list-twinkly-dragonfly.md §3.3
    // and docs/difficulty-audit-2026-05.md): collapse the per-Difficulty
    // bands to the Hard tier so a donation to / from a human player gets
    // a difficulty-independent relation threshold. This removes the
    // indirect handicap path that previously made AI relations cheaper to
    // unlock on Easy and dearer on Impossible.
    const recipientMaxPopulation = this.mg
      .config()
      .maxPopulation(this.recipient);
    return this.random.nextInt(
      recipientMaxPopulation / 9,
      recipientMaxPopulation / 7,
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
