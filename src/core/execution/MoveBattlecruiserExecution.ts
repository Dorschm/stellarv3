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
    const battlecruiser = this.owner
      .units(UnitType.Battlecruiser)
      .find((u) => u.id() === this.unitId);
    if (!battlecruiser) {
      console.warn("MoveBattlecruiserExecution: battlecruiser not found");
      return;
    }
    if (!battlecruiser.isActive()) {
      console.warn("MoveBattlecruiserExecution: battlecruiser is not active");
      return;
    }
    battlecruiser.setPatrolTile(this.position);
    battlecruiser.setTargetTile(undefined);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
