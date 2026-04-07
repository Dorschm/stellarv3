import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveBattlecruiserExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(
        `MoveBattlecruiserExecution: position ${this.position} not valid`,
      );
      return;
    }
    const warship = this.owner
      .units(UnitType.Battlecruiser)
      .find((u) => u.id() === this.unitId);
    if (!warship) {
      console.warn("MoveBattlecruiserExecution: warship not found");
      return;
    }
    if (!warship.isActive()) {
      console.warn("MoveBattlecruiserExecution: warship is not active");
      return;
    }
    warship.setPatrolTile(this.position);
    warship.setTargetTile(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
