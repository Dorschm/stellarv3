import { GameConfig } from "../Schemas";
import { Execution, Game, Player } from "../game/Game";

export class UpdateGameConfigExecution implements Execution {
  constructor(
    private requestor: Player,
    private config: Partial<GameConfig>,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!this.requestor.isLobbyCreator()) {
      console.warn(
        `SECURITY: UpdateGameConfigExecution: player ${this.requestor.id()} is not lobby creator`,
      );
      return;
    }
    mg.config().updateGameConfig(this.config);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
