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
    if (this.colony.isUnderConstruction()) {
      return;
    }
    // GDD §14 — Capital Ship hosting. A Colony slotted on a Battlecruiser
    // sits on a deep-space tile where the hab-weighted growth formula in
    // `troopIncreaseRate` produces zero contribution for that tile. To
    // keep the slot useful, a ship-hosted Colony adds a small fixed
    // population trickle each tick, capped by the player's max population
    // so it can't exceed the hab-driven ceiling.
    if (this.mg.isVoid(this.colony.tile())) {
      const owner = this.colony.owner();
      const max = this.mg.config().maxPopulation(owner);
      const current = owner.population();
      if (current < max) {
        const add = this.mg.config().shipHostedColonyPopulationPerTick();
        owner.addPopulation(Math.min(add, max - current));
      }
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
