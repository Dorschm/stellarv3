import { Execution, Game, Player } from "../game/Game";

export class MarkDisconnectedExecution implements Execution {
  constructor(
    private player: Player,
    private isDisconnected: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    // GDD §12 — permadeath gate. In permadeath runs, an eliminated faction
    // cannot reconnect; we drop the "now connected again" intent on the
    // floor (`isDisconnected: false`) so the player stays marked away and
    // the rest of the game keeps treating them as gone. The disconnect
    // direction (`isDisconnected: true`) is always honored.
    if (!this.isDisconnected && !mg.canPlayerRejoin(this.player)) {
      return;
    }
    this.player.markDisconnected(this.isDisconnected);
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
