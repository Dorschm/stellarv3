import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
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

    const range = this.mg.config().defenseStationTargettingRange();
    const cooldown = this.mg.config().defenseStationPlasmaBoltAttackRate();
    const cooldownReady = this.mg.ticks() - this.lastShellAttack > cooldown;

    // GDD §8 — Defense Satellite vs Long-Range Weapon duel loop. The LRW
    // intercept is strictly higher priority than fleet targeting because
    // shutting down a bombardment is the more strategic counter, so any
    // pending LRW impact whose target tile lies inside this station's
    // envelope is swatted down ahead of any incoming AssaultShuttle or
    // Battlecruiser. The intercept burns the same plasma-bolt cooldown
    // (`defenseStationPlasmaBoltAttackRate`, 10s) so a single station
    // can't both intercept and shoot a ship in the same window.
    //
    // Friendly filtering: the registry-level `excludeOwnerSmallID` argument
    // skips impacts owned by the station owner itself, but allied players'
    // bombardments must also be left alone. We resolve each candidate's
    // owner via `playerBySmallID` and apply `isFriendly` here so allied
    // LRW shots are never intercepted — matches the alliance contract that
    // fleet targeting already enforces below.
    if (cooldownReady) {
      const owner = this.post.owner();
      const lrwImpacts = this.mg.pendingLrwImpactsNear(
        this.post.tile(),
        range,
        owner.smallID(),
      );
      if (lrwImpacts.length > 0) {
        let bestToken = -1;
        let bestDist = Infinity;
        for (let i = 0; i < lrwImpacts.length; i++) {
          const impact = lrwImpacts[i];
          const impactOwner = this.mg.playerBySmallID(impact.ownerSmallID);
          if (
            impactOwner.isPlayer() &&
            (impactOwner as Player).isFriendly(owner)
          ) {
            continue;
          }
          if (impact.distSquared < bestDist) {
            bestDist = impact.distSquared;
            bestToken = impact.token;
          }
        }
        if (bestToken !== -1 && this.mg.interceptPendingLrwImpact(bestToken)) {
          this.lastShellAttack = this.mg.ticks();
          // Skip ship targeting this tick — the cooldown is now spent.
          return;
        }
      }
    }

    // GDD §8 — fleet intercept. Defense Satellites pick off enemy
    // AssaultShuttles and Battlecruisers within range. AssaultShuttles
    // are prioritized over Battlecruisers because they carry the
    // boarding payload that the station is here to deny.
    const ships = this.mg
      .nearbyUnits(this.post.tile(), range, [
        UnitType.AssaultShuttle,
        UnitType.Battlecruiser,
      ])
      .filter(
        ({ unit }) =>
          unit.owner() !== this.post.owner() &&
          !unit.owner().isFriendly(this.post.owner()) &&
          !this.alreadySentShell.has(unit),
      );

    this.target =
      ships.sort((a, b) => {
        const { unit: unitA, distSquared: distA } = a;
        const { unit: unitB, distSquared: distB } = b;

        // Prioritize AssaultShuttle
        if (
          unitA.type() === UnitType.AssaultShuttle &&
          unitB.type() !== UnitType.AssaultShuttle
        )
          return -1;
        if (
          unitA.type() !== UnitType.AssaultShuttle &&
          unitB.type() === UnitType.AssaultShuttle
        )
          return 1;

        // If both are the same type, sort by distance (lower `distSquared` means closer)
        return distA - distB;
      })[0]?.unit ?? null;

    if (this.target === null) {
      return;
    }
    this.shoot();
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
