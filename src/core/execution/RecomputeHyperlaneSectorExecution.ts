import { Execution, Game } from "../game/Game";
import { HyperspaceLaneNetwork } from "../game/HyperspaceLaneNetwork";

export class RecomputeHyperlaneSectorExecution implements Execution {
  constructor(private railNetwork: HyperspaceLaneNetwork) {}

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    this.railNetwork.recomputeClusters();
  }
}
