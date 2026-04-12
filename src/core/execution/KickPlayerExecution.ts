import { Execution, Game, Player, PlayerID } from "../game/Game";

export class KickPlayerExecution implements Execution {
  constructor(
    private requestor: Player,
    private targetID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!this.requestor.isLobbyCreator()) {
      console.warn(
        `SECURITY: KickPlayerExecution: player ${this.requestor.id()} is not lobby creator`,
      );
      return;
    }
    if (!mg.hasPlayer(this.targetID)) {
      console.warn(
        `KickPlayerExecution: target player ${this.targetID} not found`,
      );
      return;
    }
    const target = mg.player(this.targetID);
    if (target.id() === this.requestor.id()) {
      console.warn(`KickPlayerExecution: cannot kick yourself`);
      return;
    }
    target.markDisconnected(true);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
