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
 *
 * Per plans §5.2 the OSP can also fire at SHIPS when slotted on a
 * Battlecruiser. In that case `targetUnitId` carries the ship's unit id
 * and the impact applies a fixed health-damage chunk instead of the
 * tile-bombardment (pop + habitability) effect.
 */
interface PendingLrwImpact {
  targetTile: TileRef;
  targetSmallID: number;
  impactTick: number;
  // GDD §8 / Ticket 8 — handle into the Game-level LRW impact registry,
  // used by DefenseStation intercepts to cancel a pending impact mid-flight.
  registryToken: number;
  /**
   * When set, the shot is targeting this specific ship (cap-ship-hosted
   * OSP per plans §5.2). The reference is held directly on this private
   * queue so we don't depend on a `Game.unit(id)` lookup (which doesn't
   * exist as a top-level Game API).
   */
  targetUnit?: Unit;
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

    // plans §5.2 — when the OSP is slotted on a Battlecruiser the
    // platform sits on a deep-space (void) tile (sync from
    // BattlecruiserExecution.syncSlottedStructure). In that mode it
    // targets enemy ships instead of enemy territory. Ground-placed OSPs
    // keep the original tile-bombardment behaviour.
    const target = this.mg.isVoid(this.platform.tile())
      ? this.findLongRangeWeaponShipTarget()
      : this.findLongRangeWeaponTarget();
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
    const impactTick = currentTick + flightTicks;
    // Register the impact in the Game-level registry so DefenseStations
    // can find and intercept it mid-flight (GDD §8 / Ticket 8). The token
    // is the cancellation handle.
    const registryToken = this.mg.registerPendingLrwImpact(
      owner.smallID(),
      this.platform.tile(),
      target.tile,
      impactTick,
    );
    this.pendingImpacts.push({
      targetTile: target.tile,
      targetSmallID: target.smallID,
      impactTick,
      registryToken,
      targetUnit: (target as { unit?: Unit }).unit,
    });
  }

  /**
   * Apply LRW impact effects.
   *
   * Two flavours:
   *   - **Ship impact** (plans §5.2 — cap-ship-hosted OSP):
   *     `impact.targetUnitId` is set. Apply a flat health damage chunk
   *     (`Config.lrwShipDamage`) to the target ship if it's still alive
   *     and still hostile.
   *   - **Tile impact** (legacy ground OSP behaviour):
   *     10% population damage to the target player + 10% habitability
   *     damage to the impacted tile.
   */
  private applyLrwImpact(impact: PendingLrwImpact): void {
    const config = this.mg.config();
    if (impact.targetUnit !== undefined) {
      this.applyLrwShipImpact(impact, config.lrwShipDamage());
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
   * Apply an LRW projectile's impact to a specific ship target. The ship
   * is looked up by unit id at impact time so an intervening
   * destruction / capture is handled cleanly. Friendly-fire is
   * additionally guarded — if the target became allied or got captured
   * by the OSP owner mid-flight, the shot fizzles silently.
   *
   * plans §5.2 — implemented as `modifyHealth(-damage)`, which clamps
   * to zero / triggers the unit's normal destruction path. No habitability
   * damage is applied (the target may not even be on a sector tile).
   */
  private applyLrwShipImpact(
    impact: PendingLrwImpact,
    damage: number,
  ): void {
    const target = impact.targetUnit;
    if (target === undefined || !target.isActive() || !target.hasHealth()) {
      return;
    }
    const owner = this.platform.owner();
    const tOwner = target.owner();
    if (tOwner === owner || tOwner.isFriendly(owner)) {
      return;
    }
    target.modifyHealth(-damage, owner);
  }

  /**
   * Pick the closest enemy SHIP within `longRangeWeaponMaxRange` of the
   * platform. Used when the OSP is slotted on a Battlecruiser (its tile
   * sits in deep space). Returns `null` when no eligible ship is within
   * range. Mirrors the structure of `findLongRangeWeaponTarget` but
   * scans `nearbyUnits` for ship types instead of doing a square ring
   * sweep over tiles.
   */
  private findLongRangeWeaponShipTarget(): {
    tile: TileRef;
    smallID: number;
    unit: Unit;
  } | null {
    const owner = this.platform.owner();
    const maxRange = this.mg.config().longRangeWeaponMaxRange();
    const candidates = this.mg.nearbyUnits(this.platform.tile(), maxRange, [
      UnitType.AssaultShuttle,
      UnitType.Battlecruiser,
      UnitType.TradeFreighter,
    ]);

    let best: { tile: TileRef; smallID: number; unit: Unit } | null = null;
    let bestDist = Infinity;
    for (const { unit, distSquared } of candidates) {
      const u = unit.owner();
      if (u === owner) continue;
      if (u.isFriendly(owner)) continue;
      if (!owner.canAttackPlayer(u, true)) continue;
      if (!unit.isActive()) continue;
      if (unit === this.platform) continue;
      if (distSquared < bestDist) {
        bestDist = distSquared;
        best = {
          tile: unit.tile(),
          smallID: u.smallID(),
          unit,
        };
      }
    }
    return best;
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
