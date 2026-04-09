import { Execution, Game, Unit } from "../game/Game";

export class OrbitalStrikePlatformExecution implements Execution {
  private active = true;
  private mg: Game;
  private platform: Unit;

  constructor(platform: Unit) {
    this.platform = platform;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.platform.isUnderConstruction()) {
      return;
    }

    // frontTime is the time the earliest missile fired.
    const frontTime = this.platform.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }

    const cooldown =
      this.mg.config().orbitalStrikeCooldown() - (this.mg.ticks() - frontTime);

    if (cooldown <= 0) {
      this.platform.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
