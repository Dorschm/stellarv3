import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TradeHubExecution } from "./TradeHubExecution";

export class ColonyExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private stationCreated = false;

  constructor(private colony: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.colony.isActive()) {
      this.active = false;
      return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.colony.tile()!,
      this.mg.config().tradeHubMaxRange(),
      UnitType.Foundry,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TradeHubExecution(this.colony));
    }
  }
}
