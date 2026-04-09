import { Execution, Game, Player, UnitType } from "../game/Game";

export class ShuttleRetreatExecution implements Execution {
  private active = true;
  constructor(
    private player: Player,
    private unitID: number,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    const unit = this.player
      .units()
      .find(
        (unit) =>
          unit.id() === this.unitID && unit.type() === UnitType.AssaultShuttle,
      );

    if (!unit) {
      console.warn(`Didn't find outgoing shuttle with id ${this.unitID}`);
      this.active = false;
      return;
    }

    unit.orderShuttleRetreat();
    this.active = false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
