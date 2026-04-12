import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
} from "../../game/Game";

export class VoteForPeaceExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    private voter: Player,
    private targetID: PlayerID,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;

    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`VoteForPeaceExecution: target ${this.targetID} not found`);
      this.active = false;
      return;
    }

    const target = mg.player(this.targetID);

    if (target === this.voter) {
      console.warn("VoteForPeaceExecution: cannot vote for yourself");
      this.active = false;
      return;
    }

    if (!this.voter.isAlliedWith(target)) {
      console.warn(
        `VoteForPeaceExecution: ${this.voter.name()} is not allied with ${target.name()}`,
      );
      this.active = false;
      return;
    }

    mg.recordPeaceVote(this.voter, target);

    mg.displayMessage(
      "events_display.peace_vote_cast",
      MessageType.PEACE_VOTE,
      this.voter.id(),
      undefined,
      { name: target.displayName() },
    );

    this.active = false;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
