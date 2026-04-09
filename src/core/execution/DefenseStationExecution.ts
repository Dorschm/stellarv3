import { Execution, Game, Unit } from "../game/Game";
import { PlasmaBoltExecution } from "./PlasmaBoltExecution";

export class DefenseStationExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private target: Unit | null = null;
  private lastShellAttack = 0;

  private alreadySentShell = new Set<Unit>();

  constructor(private post: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private shoot() {
    if (this.target === null) return;
    const shellAttackRate = this.mg
      .config()
      .defenseStationPlasmaBoltAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new PlasmaBoltExecution(
          this.post.tile(),
          this.post.owner(),
          this.post,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = null;
        return;
      }
    }
  }

  tick(ticks: number): void {
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }

    // Do nothing while the structure is under construction
    if (this.post.isUnderConstruction()) {
      return;
    }

    if (this.target !== null && !this.target.isActive()) {
      this.target = null;
    }

    // TODO: Reconsider how/if defense posts target ships.
    // const ships = this.mg
    //   .nearbyUnits(
    //     this.post.tile(),
    //     this.mg.config().defenseStationTargettingRange(),
    //     [UnitType.AssaultShuttle, UnitType.Battlecruiser],
    //   )
    //   .filter(
    //     ({ unit }) =>
    //       this.post !== null &&
    //       unit.owner() !== this.post.owner() &&
    //       !unit.owner().isFriendly(this.post.owner()) &&
    //       !this.alreadySentShell.has(unit),
    //   );
    //
    // this.target =
    //   ships.sort((a, b) => {
    //     const { unit: unitA, distSquared: distA } = a;
    //     const { unit: unitB, distSquared: distB } = b;
    //
    //     // Prioritize AssaultShuttle
    //     if (
    //       unitA.type() === UnitType.AssaultShuttle &&
    //       unitB.type() !== UnitType.AssaultShuttle
    //     )
    //       return -1;
    //     if (
    //       unitA.type() !== UnitType.AssaultShuttle &&
    //       unitB.type() === UnitType.AssaultShuttle
    //     )
    //       return 1;
    //
    //     // If both are the same type, sort by distance (lower `distSquared` means closer)
    //     return distA - distB;
    //   })[0]?.unit ?? null;
    //
    // if (this.target === null || !this.target.isActive()) {
    //   this.target = null;
    //   return;
    // } else {
    //   this.shoot();
    //   return;
    // }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
