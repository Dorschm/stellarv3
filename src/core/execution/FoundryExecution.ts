import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TradeHubExecution } from "./TradeHubExecution";

export class FoundryExecution implements Execution {
  private active: boolean = true;
  private game: Game;
  private stationCreated = false;

  constructor(private factory: Unit) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.factory.isActive()) {
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
    const structures = this.game.nearbyUnits(
      this.factory.tile()!,
      this.game.config().tradeHubMaxRange(),
      [UnitType.Colony, UnitType.Spaceport, UnitType.Foundry],
    );

    this.game.addExecution(new TradeHubExecution(this.factory, true));
    for (const { unit } of structures) {
      if (!unit.hasTradeHub()) {
        this.game.addExecution(new TradeHubExecution(unit));
      }
    }
  }
}
