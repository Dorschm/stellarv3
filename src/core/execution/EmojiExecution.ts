import {
  AllPlayers,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { flattenedEmojiTable } from "../Util";
import { respondToEmoji } from "./nation/NationEmojiBehavior";

export class EmojiExecution implements Execution {
  private recipient: Player | typeof AllPlayers;

  private mg: Game;
  private random: PseudoRandom;

  private active = true;

  constructor(
    private requestor: Player,
    private recipientID: PlayerID | typeof AllPlayers,
    private emoji: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (this.recipientID !== AllPlayers && !mg.hasPlayer(this.recipientID)) {
      console.warn(`EmojiExecution: recipient ${this.recipientID} not found`);
      this.active = false;
      return;
    }

    this.recipient =
      this.recipientID === AllPlayers
        ? AllPlayers
        : mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    const emojiString = flattenedEmojiTable[this.emoji];
    if (emojiString === undefined) {
      console.warn(
        `cannot send emoji ${this.emoji} from ${this.requestor} to ${this.recipient}`,
      );
    } else if (this.requestor.canSendEmoji(this.recipient)) {
      this.requestor.sendEmoji(this.recipient, emojiString);
      // Surface visible feedback in the events panel for both ends —
      // PlayerIcons.outgoingEmojis() built the data structure for an
      // in-map bubble, but no R3F/HUD component currently consumes it,
      // so without these displayMessage calls a player who clicks an
      // emoji sees nothing happen on screen at all (the user-reported
      // "emotes are not working" symptom). The bubble overlay is a
      // separate follow-up; this restores the minimum viable feedback.
      const recipientName =
        this.recipient === AllPlayers
          ? "everyone"
          : (this.recipient as Player).displayName();
      this.mg.displayMessage(
        "events_display.emoji_sent",
        MessageType.EMOJI_SENT,
        this.requestor.id(),
        undefined,
        { emoji: emojiString, recipient: recipientName },
      );
      // Notify the recipient too. For broadcast (AllPlayers) we'd flood
      // every player's events panel with one entry per other-player
      // emoji, so skip the recipient-side message in that case — the
      // sender's "you sent" message still lands in their own panel.
      if (this.recipient !== AllPlayers) {
        this.mg.displayMessage(
          "events_display.emoji_received",
          MessageType.EMOJI_RECEIVED,
          (this.recipient as Player).id(),
          undefined,
          {
            emoji: emojiString,
            sender: this.requestor.displayName(),
          },
        );
      }
      respondToEmoji(
        this.mg,
        this.random,
        this.requestor,
        this.recipient,
        emojiString,
      );
    } else {
      console.warn(
        `cannot send emoji from ${this.requestor} to ${this.recipient}`,
      );
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
