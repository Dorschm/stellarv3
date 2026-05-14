import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Pending Long-Range Weapon impact. The OSP fires a fast projectile (3 AU/s
 * = 30 tiles/tick at AU=100) which we model abstractly: at fire time we
 * resolve the target, deduct credits, and schedule the impact for
 * `tick + ceil(distance / projectileSpeed)`. The projectile itself is not
 * a Unit — there is no model to render and no PDA-style intercept path,
 * so spawning a Unit would just bloat updates without changing behaviour.
 * See Ticket 5: Structure Alignment.
 */
interface PendingLrwImpact {
  targetTile: TileRef;
  targetSmallID: number;
  impactTick: number;
  // GDD §8 / Ticket 8 — handle into the Game-level LRW impact registry,
  // used by DefenseStation intercepts to cancel a pending impact mid-flight.
  registryToken: number;
  // Issue #8 — when the OSP is hosted on a Battlecruiser, the LRW targets
  // a ship rather than a ground tile. We carry a reference to the target
  // unit so the impact applies flat damage on the ship and skips the
  // habitability-overlay path. The Unit may have been destroyed between
  // fire and impact; `isActive()` guards that case at impact time.
  targetShip?: Unit;
}

/** OSP target kinds — ground (legacy ground-tile bombardment) or ship
 * (anti-ship LRW used when the OSP is slotted on a Battlecruiser). */
const SHIP_TARGETABLE_TYPES: UnitType[] = [
  UnitType.Battlecruiser,
  UnitType.AssaultShuttle,
  UnitType.TradeFreighter,
];

export class OrbitalStrikePlatformExecution implements Execution {
  private active = true;
  private mg: Game;
  private platform: Unit;

  // GDD §5 Long-Range Weapon state -------------------------------------------
  // Tick number at which the LRW becomes available again. -1 means "not yet
  // armed" (set on first tick after the platform finishes construction).
  private lrwReadyTick: number = -1;
  private pendingImpacts: PendingLrwImpact[] = [];

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

    // Resolve any pending LRW impacts whose flight time has elapsed. We
    // pop in-place from the head of the queue because impacts are scheduled
    // in tick order — anything past `impactTick` is ready, anything earlier
    // shouldn't exist. An impact whose registry token has already been
    // cleared was intercepted mid-flight by a DefenseStation (GDD §8) and
    // is silently dropped without applying any effects.
    while (
      this.pendingImpacts.length > 0 &&
      this.pendingImpacts[0].impactTick <= ticks
    ) {
      const impact = this.pendingImpacts.shift()!;
      if (!this.mg.isPendingLrwImpactActive(impact.registryToken)) {
        continue;
      }
      this.mg.unregisterPendingLrwImpact(impact.registryToken);
      this.applyLrwImpact(impact);
    }

    // Original missile-slot cooldown for nuke launches via this OSP. The
    // OSP doubles as a launch pad for AntimatterTorpedo / NovaBomb shots
    // (see PlayerImpl.nukeSpawn) — the missile timer queue tracks those
    // launches and is unrelated to the LRW cooldown.
    const frontTime = this.platform.missileTimerQueue()[0];
    if (frontTime !== undefined) {
      const cooldown =
        this.mg.config().orbitalStrikeCooldown() -
        (this.mg.ticks() - frontTime);
      if (cooldown <= 0) {
        this.platform.reloadMissile();
      }
    }

    if (!this.platform.isActive()) {
      // GDD §8 / Ticket 8 — when the firing platform is destroyed
      // mid-flight, any LRW impacts still queued must be deterministically
      // cancelled, not silently abandoned. Leaving them in the registry
      // produces ghost impacts: a DefenseStation could spend its cooldown
      // intercepting a phantom shot that would never have landed, and the
      // pending-impact map would leak entries forever. We unregister and
      // drop every remaining queued impact before deactivating execution
      // so the registry is fully consistent with platform liveness.
      this.cancelPendingImpactsOnTeardown();
      this.active = false;
      return;
    }

    // GDD §5 — auto-fire Long-Range Weapon at the closest enemy player
    // tile within range, once per cooldown, when the owner can pay the
    // shot cost.
    if (this.lrwReadyTick === -1) {
      this.lrwReadyTick = ticks;
    }
    if (ticks >= this.lrwReadyTick) {
      this.maybeFireLongRangeWeapon(ticks);
    }
  }

  /**
   * Drain the local pending-impact queue and unregister every remaining
   * registry token. Called from {@link tick} when the platform has just
   * become inactive (typically because the OSP unit was destroyed). After
   * this returns, the queue is empty and no Game-level intercept handle
   * still references this execution — DefenseStations will no longer see
   * any of the cancelled impacts as candidates.
   */
  private cancelPendingImpactsOnTeardown(): void {
    for (const impact of this.pendingImpacts) {
      if (this.mg.isPendingLrwImpactActive(impact.registryToken)) {
        this.mg.unregisterPendingLrwImpact(impact.registryToken);
      }
    }
    this.pendingImpacts.length = 0;
  }

  /**
   * Find the closest reachable enemy-owned tile and, if the owner can pay
   * the shot cost, schedule an LRW impact and reset the cooldown. Targeting
   * is intentionally simple: walk a square ring around the platform out to
   * the LRW max range (bounded by `defaultNukeTargetableRange()`) and pick
   * the first tile owned by an enemy player. The platform passes any tile
   * within range — line-of-sight / sector boundaries are ignored, matching
   * the GDD's "cross-sector bombardment" wording.
   */
  private maybeFireLongRangeWeapon(currentTick: number): void {
    const config = this.mg.config();
    const cost = config.longRangeWeaponShotCost();
    const owner = this.platform.owner();
    if (owner.credits() < cost) {
      return;
    }

    // Issue #8 — when the OSP is slotted on a Battlecruiser its LRW fires
    // at enemy SHIPS rather than ground tiles. We detect host status via
    // the explicit `isHostedOnCapitalShip()` predicate (which reads through
    // the back-reference) rather than just "is on a void tile" so an OSP
    // that happens to overhang deep space (e.g. a coastal sector boundary)
    // still uses ground targeting.
    const hostedOnCapShip = this.platform.isHostedOnCapitalShip();

    const shipTarget = hostedOnCapShip ? this.findShipTargetInRange() : null;
    const groundTarget = hostedOnCapShip
      ? null
      : this.findLongRangeWeaponTarget();
    if (shipTarget === null && groundTarget === null) {
      return;
    }

    // Deduct credits and lock the platform out for the LRW cooldown.
    owner.removeCredits(cost);
    this.lrwReadyTick = currentTick + config.orbitalStrikeCooldown();

    // Schedule the impact based on the projectile's tile-per-tick speed.
    const speed = config.longRangeWeaponProjectileSpeed();
    const targetTile =
      shipTarget !== null ? shipTarget.tile : groundTarget!.tile;
    const distance = this.mg.manhattanDist(this.platform.tile(), targetTile);
    // At least 1 tick of travel so the impact never resolves on the same
    // tick the shot was fired (gives the cooldown a sane lower bound).
    const flightTicks = Math.max(1, Math.ceil(distance / Math.max(1, speed)));
    const impactTick = currentTick + flightTicks;
    // Register the impact in the Game-level registry so DefenseStations
    // can find and intercept it mid-flight (GDD §8 / Ticket 8). The token
    // is the cancellation handle.
    const registryToken = this.mg.registerPendingLrwImpact(
      owner.smallID(),
      this.platform.tile(),
      targetTile,
      impactTick,
    );
    this.pendingImpacts.push({
      targetTile,
      targetSmallID:
        shipTarget !== null ? shipTarget.ownerSmallID : groundTarget!.smallID,
      impactTick,
      registryToken,
      targetShip: shipTarget?.unit,
    });
  }

  /**
   * Apply LRW impact effects: 10% population damage to the target player
   * (subtracted from current population) and 10% habitability damage to the
   * impacted tile via the SectorMap overlay. Both ratios are configured
   * by `Config.longRangeWeapon*` so they can be tuned in one place.
   */
  private applyLrwImpact(impact: PendingLrwImpact): void {
    const config = this.mg.config();

    // Issue #8 — ship-target impact path. When the OSP fired at a ship,
    // apply flat ship damage and skip the habitability overlay (the impact
    // tile is a deep-space void, not a ground tile).
    if (impact.targetShip !== undefined) {
      const ship = impact.targetShip;
      if (ship.isActive()) {
        ship.modifyHealth(-config.lrwShipDamage());
      }
      return;
    }

    const target = this.mg.playerBySmallID(impact.targetSmallID);
    if (!target.isPlayer()) {
      return;
    }
    const targetPlayer = target as Player;

    // 10% population damage — pulled from current population count to keep the
    // damage scale meaningful even after population growth/decay since launch.
    const popLoss = Math.floor(
      targetPlayer.population() * config.longRangeWeaponPopulationDamageRatio(),
    );
    if (popLoss > 0) {
      targetPlayer.removePopulation(popLoss);
    }

    // 10% habitability damage to the impact tile. The SectorMap is the
    // authoritative store for per-tile habitability and the running per-
    // player averages — `applyHabitabilityDamage` keeps both consistent.
    const ownerOfTile = this.mg.owner(impact.targetTile);
    const ownerSmallID = ownerOfTile.isPlayer()
      ? (ownerOfTile as Player).smallID()
      : null;
    this.mg
      .sectorMap()
      .applyHabitabilityDamage(
        impact.targetTile,
        config.longRangeWeaponHabitabilityDamage(),
        ownerSmallID,
      );
  }

  /**
   * Issue #8 — find the nearest enemy ship in LRW range. Used only when
   * the OSP is hosted on a Battlecruiser; ground OSPs continue to use
   * {@link findLongRangeWeaponTarget}. Returns `null` if no eligible ship
   * is in range.
   */
  private findShipTargetInRange(): {
    tile: TileRef;
    ownerSmallID: number;
    unit: Unit;
  } | null {
    const config = this.mg.config();
    const maxRange = config.longRangeWeaponMaxRange();
    const owner = this.platform.owner();
    const nearby = this.mg.nearbyUnits(
      this.platform.tile(),
      maxRange,
      SHIP_TARGETABLE_TYPES,
    );
    let bestUnit: Unit | null = null;
    let bestDist = Infinity;
    for (const { unit, distSquared } of nearby) {
      const u = unit;
      if (!u.isActive()) continue;
      const shipOwner = u.owner();
      if (shipOwner === owner) continue;
      // Issue #8 — gate ship targeting on the same `canAttackPlayer` check
      // ground bombardment uses (via `canAttack`). This catches spawn
      // immunity for human / nation targets — without it, a hosted LRW
      // could fire on an enemy ship whose owner is still under the
      // post-spawn immunity window, breaking the same protection the
      // ground-target path already honors.
      if (!shipOwner.isPlayer()) continue;
      if (!owner.canAttackPlayer(shipOwner)) continue;
      if (distSquared < bestDist) {
        bestDist = distSquared;
        bestUnit = u;
      }
    }
    if (bestUnit === null) return null;
    return {
      tile: bestUnit.tile(),
      ownerSmallID: bestUnit.owner().smallID(),
      unit: bestUnit,
    };
  }

  /**
   * Pick the closest enemy-owned tile within `longRangeWeaponMaxRange()`.
   * Returns null when no enemy tile is reachable. The scan is O(range²)
   * which is bounded (range ≤ defaultNukeTargetableRange ≈ 150) so this
   * runs comfortably within a tick budget.
   */
  private findLongRangeWeaponTarget(): {
    tile: TileRef;
    smallID: number;
  } | null {
    const config = this.mg.config();
    const maxRange = config.longRangeWeaponMaxRange();
    const owner = this.platform.owner();
    const platformTile = this.platform.tile();
    const platformX = this.mg.x(platformTile);
    const platformY = this.mg.y(platformTile);

    let bestTile: TileRef | null = null;
    let bestSmallID = 0;
    let bestDistSquared = Infinity;
    const maxRangeSquared = maxRange * maxRange;

    for (let dy = -maxRange; dy <= maxRange; dy++) {
      const ty = platformY + dy;
      if (ty < 0 || ty >= this.mg.height()) continue;
      for (let dx = -maxRange; dx <= maxRange; dx++) {
        const distSquared = dx * dx + dy * dy;
        if (distSquared > maxRangeSquared) continue;
        if (distSquared >= bestDistSquared) continue;
        const tx = platformX + dx;
        if (tx < 0 || tx >= this.mg.width()) continue;
        const tileOwner = this.mg.owner(this.mg.ref(tx, ty));
        if (!tileOwner.isPlayer()) continue;
        const tilePlayer = tileOwner as Player;
        if (tilePlayer === owner) continue;
        if (tilePlayer.isFriendly(owner)) continue;
        bestTile = this.mg.ref(tx, ty);
        bestSmallID = tilePlayer.smallID();
        bestDistSquared = distSquared;
      }
    }

    return bestTile === null ? null : { tile: bestTile, smallID: bestSmallID };
  }

  /** Test hook — exposes the pending-impact queue length. */
  public pendingLrwImpactCount(): number {
    return this.pendingImpacts.length;
  }

  /** Test hook — tick at which the LRW will be ready to fire again. */
  public lrwReadyAt(): number {
    return this.lrwReadyTick;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
