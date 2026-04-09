import {
  Credits,
  Difficulty,
  Execution,
  Game,
  Player,
  PlayerID,
  PlayerType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { assertNever, toInt } from "../Util";
import { EmojiExecution } from "./EmojiExecution";
import {
  EMOJI_DONATION_OK,
  EMOJI_DONATION_TOO_SMALL,
  EMOJI_LOVE,
} from "./nation/NationEmojiBehavior";

export class DonateCreditsExecution implements Execution {
  private recipient: Player;
  private credits: Credits;

  private mg: Game;
  private random: PseudoRandom;

  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    goldNum: number | null,
  ) {
    this.credits = toInt(goldNum ?? 0);
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonateCreditsExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.credits ??= this.sender.credits() / 3n;
  }

  tick(ticks: number): void {
    if (this.credits === null) throw new Error("not initialized");
    if (
      this.sender.canDonateCredits(this.recipient) &&
      this.sender.donateCredits(this.recipient, this.credits)
    ) {
      // Give relation points based on how many credits were donated
      const relationUpdate = this.calculateRelationUpdate(this.credits, ticks);
      if (relationUpdate > 0) {
        this.recipient.updateRelation(this.sender, relationUpdate);
      }

      // Only AI nations auto-respond with emojis, human players should not
      if (
        this.recipient.type() === PlayerType.Nation &&
        this.recipient.canSendEmoji(this.sender)
      ) {
        // Select emoji based on donation value
        const emoji =
          relationUpdate >= 50
            ? EMOJI_LOVE
            : relationUpdate > 0
              ? EMOJI_DONATION_OK
              : EMOJI_DONATION_TOO_SMALL;

        this.mg.addExecution(
          new EmojiExecution(
            this.recipient,
            this.sender.id(),
            this.random.randElement(emoji),
          ),
        );
      }
    } else {
      console.warn(
        `cannot send credits from ${this.sender.name()} to ${this.recipient.name()}`,
      );
    }
    this.active = false;
  }

  private getGoldChunkSize(): number {
    const { difficulty } = this.mg.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 2_500;
      case Difficulty.Medium:
        return 5_000;
      case Difficulty.Hard:
        return 12_500;
      case Difficulty.Impossible:
        return 25_000;
      default:
        assertNever(difficulty);
    }
  }

  private calculateRelationUpdate(creditsSent: Credits, ticks: number): number {
    const chunkSize = this.getGoldChunkSize();
    // For every 5 minutes that pass, multiply the chunk size to scale with game progression
    const chunkSizeMultiplier =
      ticks / (3000 + this.mg.config().numSpawnPhaseTurns());
    const adjustedChunkSize = BigInt(
      Math.round(chunkSize + chunkSize * chunkSizeMultiplier),
    );
    // Calculate how many complete chunks were donated
    const chunks = Number(creditsSent / adjustedChunkSize);
    // Each chunk gives 5 relation points
    const relationUpdate = chunks * 5;
    // Cap at 100 relation points
    if (relationUpdate > 100) return 100;
    return relationUpdate;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
