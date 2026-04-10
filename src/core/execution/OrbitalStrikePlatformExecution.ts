import { Execution, Game, Player, Unit } from "../game/Game";
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
}

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
    // shouldn't exist.
    while (
      this.pendingImpacts.length > 0 &&
      this.pendingImpacts[0].impactTick <= ticks
    ) {
      const impact = this.pendingImpacts.shift()!;
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

    const target = this.findLongRangeWeaponTarget();
    if (target === null) {
      return;
    }

    // Deduct credits and lock the platform out for the LRW cooldown.
    owner.removeCredits(cost);
    this.lrwReadyTick = currentTick + config.orbitalStrikeCooldown();

    // Schedule the impact based on the projectile's tile-per-tick speed.
    const speed = config.longRangeWeaponProjectileSpeed();
    const distance = this.mg.manhattanDist(this.platform.tile(), target.tile);
    // At least 1 tick of travel so the impact never resolves on the same
    // tick the shot was fired (gives the cooldown a sane lower bound).
    const flightTicks = Math.max(1, Math.ceil(distance / Math.max(1, speed)));
    this.pendingImpacts.push({
      targetTile: target.tile,
      targetSmallID: target.smallID,
      impactTick: currentTick + flightTicks,
    });
  }

  /**
   * Apply LRW impact effects: 10% population damage to the target player
   * (subtracted from current troops) and 10% habitability damage to the
   * impacted tile via the SectorMap overlay. Both ratios are configured
   * by `Config.longRangeWeapon*` so they can be tuned in one place.
   */
  private applyLrwImpact(impact: PendingLrwImpact): void {
    const config = this.mg.config();
    const target = this.mg.playerBySmallID(impact.targetSmallID);
    if (!target.isPlayer()) {
      return;
    }
    const targetPlayer = target as Player;

    // 10% population damage — pulled from current troop count to keep the
    // damage scale meaningful even after troop growth/decay since launch.
    const popLoss = Math.floor(
      targetPlayer.troops() * config.longRangeWeaponPopulationDamageRatio(),
    );
    if (popLoss > 0) {
      targetPlayer.removeTroops(popLoss);
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
