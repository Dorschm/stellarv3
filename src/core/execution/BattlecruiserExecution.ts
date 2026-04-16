import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Player,
  TerrainType,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { PlasmaBoltExecution } from "./PlasmaBoltExecution";

export class BattlecruiserExecution implements Execution {
  private random: PseudoRandom;
  private battlecruiser: Unit;
  private mg: Game;
  private pathfinder: SteppingPathFinder<TileRef>;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();

  constructor(
    private input: (UnitParams<UnitType.Battlecruiser> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = PathFinding.DeepSpace(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.battlecruiser = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.Battlecruiser,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(
          `Failed to spawn battlecruiser for ${this.input.owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.battlecruiser = this.input.owner.buildUnit(
        UnitType.Battlecruiser,
        spawn,
        this.input,
      );
    }
  }

  tick(ticks: number): void {
    if (this.battlecruiser.health() <= 0) {
      this.battlecruiser.delete();
      return;
    }

    // GDD §3.2 — recurring fleet upkeep charged to the current owner
    // (accounts for capture via captureUnit). `removeCredits` deducts up
    // to the available balance, so hitting 0 credits does not destroy
    // the cruiser.
    const cruiserOwner = this.battlecruiser.owner();
    const upkeep = this.mg.config().battlecruiserUpkeepPerTick(cruiserOwner);
    if (upkeep > 0n) {
      cruiserOwner.removeCredits(upkeep);
    }

    const hasPort =
      this.battlecruiser.owner().unitCount(UnitType.Spaceport) > 0;
    if (hasPort) {
      this.battlecruiser.modifyHealth(1);
    }

    this.battlecruiser.setTargetUnit(this.findTargetUnit());
    if (this.battlecruiser.targetUnit()?.type() === UnitType.TradeFreighter) {
      this.huntDownTradeFreighter();
      this.syncSlottedStructure();
      return;
    }

    // Evaluate ship targeting / LRW intercept against the start-of-tick
    // position BEFORE patrol movement — otherwise a cruiser that began
    // the tick inside intercept range could patrol out of range and miss
    // a valid same-tick intercept. Ship targets still take priority over
    // LRW intercept (cruiser is primarily a combat ship). Patrol only
    // runs when no intercept shot was fired, so the intercept isn't
    // immediately undone by a movement step.
    let intercepted = false;
    if (this.battlecruiser.targetUnit() !== undefined) {
      this.shootTarget();
    } else {
      intercepted = this.tryInterceptLrw();
    }

    if (!intercepted) {
      this.patrol();
    }

    this.syncSlottedStructure();
  }

  /**
   * GDD §8 — "Satellites or fleets can intercept projectiles within range."
   * The Battlecruiser is the fleet-side intercepter. Unlike DefenseStations
   * (which prioritize LRW intercept over ship targeting), the cruiser is
   * primarily a combat ship, so the intercept only fires when no ship
   * target is engaged. The intercept shares the plasma-bolt cooldown
   * (`battlecruiserPlasmaBoltAttackRate`) so a single cruiser can't both
   * shoot a ship and swat an LRW in the same window.
   *
   * Friendly filtering: the registry-level `excludeOwnerSmallID` argument
   * skips impacts owned by the cruiser's owner, but allied players'
   * bombardments must also be left alone — we resolve each candidate's
   * owner via `playerBySmallID` and apply `isFriendly` here, matching
   * DefenseStationExecution.
   */
  private tryInterceptLrw(): boolean {
    const cooldown = this.mg.config().battlecruiserPlasmaBoltAttackRate();
    if (this.mg.ticks() - this.lastShellAttack <= cooldown) return false;

    const owner = this.battlecruiser.owner();
    const range = this.mg.config().battlecruiserTargettingRange();
    const lrwImpacts = this.mg.pendingLrwImpactsNear(
      this.battlecruiser.tile(),
      range,
      owner.smallID(),
    );
    if (lrwImpacts.length === 0) return false;

    let bestToken = -1;
    let bestDist = Infinity;
    for (let i = 0; i < lrwImpacts.length; i++) {
      const impact = lrwImpacts[i];
      const impactOwner = this.mg.playerBySmallID(impact.ownerSmallID);
      if (impactOwner.isPlayer() && (impactOwner as Player).isFriendly(owner)) {
        continue;
      }
      if (impact.distSquared < bestDist) {
        bestDist = impact.distSquared;
        bestToken = impact.token;
      }
    }
    if (bestToken !== -1 && this.mg.interceptPendingLrwImpact(bestToken)) {
      this.lastShellAttack = this.mg.ticks();
      return true;
    }
    return false;
  }

  /**
   * GDD §14 / Ticket 6 — a Battlecruiser acts as a mobile one-slot planet.
   * When the cruiser moves, its hosted structure (DefenseStation or
   * OrbitalStrikePlatform) must follow so it retains line-of-sight to its
   * patrol tile. We sync after every motion decision rather than hooking
   * into the generic `move()` path because only Battlecruisers carry a
   * structure — the cost of an `isActive() + move()` check per tick is
   * negligible compared to touching every unit's move path.
   */
  private syncSlottedStructure(): void {
    const slotted = this.battlecruiser.slottedStructure();
    if (slotted === undefined) return;
    if (!slotted.isActive()) {
      // Structure was destroyed independently (e.g., nuked) — clear the
      // slot so a replacement can be built.
      this.battlecruiser.setSlottedStructure(undefined);
      return;
    }
    const cruiserTile = this.battlecruiser.tile();
    if (slotted.tile() !== cruiserTile) {
      slotted.move(cruiserTile);
    }
  }

  private findTargetUnit(): Unit | undefined {
    const mg = this.mg;
    const config = mg.config();
    const owner = this.battlecruiser.owner();
    const hasPort = owner.unitCount(UnitType.Spaceport) > 0;
    const patrolTile = this.battlecruiser.patrolTile()!;
    const patrolRangeSquared = config.battlecruiserPatrolRange() ** 2;

    const ships = mg.nearbyUnits(
      this.battlecruiser.tile()!,
      config.battlecruiserTargettingRange(),
      [
        UnitType.AssaultShuttle,
        UnitType.Battlecruiser,
        UnitType.TradeFreighter,
      ],
    );

    let bestUnit: Unit | undefined = undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit.owner() === owner ||
        unit === this.battlecruiser ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit)
      ) {
        continue;
      }

      const type = unit.type();
      if (type === UnitType.TradeFreighter) {
        if (
          !hasPort ||
          unit.isSafeFromRaiders() ||
          unit.targetUnit()?.owner() === owner || // trade freighter heading to my spaceport
          unit.targetUnit()?.owner().isFriendly(owner) // trade freighter heading to my ally
        ) {
          continue;
        }
        if (
          mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared
        ) {
          // Prevent battlecruiser from chasing trade freighter that is too far
          // from the patrol tile to prevent battlecruisers from wandering.
          continue;
        }
      }

      const typePriority =
        type === UnitType.AssaultShuttle
          ? 0
          : type === UnitType.Battlecruiser
            ? 1
            : 2;

      if (bestUnit === undefined) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
        continue;
      }

      // Match existing `sort()` semantics:
      // - Lower priority is better (AssaultShuttle < Battlecruiser < TradeFreighter).
      // - For same type, smaller distance is better.
      // - For exact ties, keep the first encountered (stable sort behavior).
      if (
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  private shootTarget() {
    const shellAttackRate = this.mg
      .config()
      .battlecruiserPlasmaBoltAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (this.battlecruiser.targetUnit()?.type() !== UnitType.AssaultShuttle) {
        // Battlecruisers don't need to reload when attacking assault shuttles.
        this.lastShellAttack = this.mg.ticks();
      }
      this.mg.addExecution(
        new PlasmaBoltExecution(
          this.battlecruiser.tile(),
          this.battlecruiser.owner(),
          this.battlecruiser,
          this.battlecruiser.targetUnit()!,
        ),
      );
      if (!this.battlecruiser.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.battlecruiser.targetUnit()!);
        this.battlecruiser.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeFreighter() {
    for (let i = 0; i < 2; i++) {
      // target is trade freighter so capture it.
      const result = this.pathfinder.next(
        this.battlecruiser.tile(),
        this.battlecruiser.targetUnit()!.tile(),
        5,
      );
      switch (result.status) {
        case PathStatus.COMPLETE:
          // Stationary capture: cruiser is already within range so no tile
          // change happens. Territory only claims on real movement.
          this.battlecruiser
            .owner()
            .captureUnit(this.battlecruiser.targetUnit()!);
          this.battlecruiser.setTargetUnit(undefined);
          this.battlecruiser.move(this.battlecruiser.tile());
          return;
        case PathStatus.NEXT:
          this.battlecruiser.move(result.node);
          this.claimTerritoryRadius();
          break;
        case PathStatus.NOT_FOUND: {
          console.log(`path not found to target`);
          break;
        }
      }
    }
  }

  private patrol() {
    if (this.battlecruiser.targetTile() === undefined) {
      this.battlecruiser.setTargetTile(this.randomTile());
      if (this.battlecruiser.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.battlecruiser.tile(),
      this.battlecruiser.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE: {
        // COMPLETE can fire without any tile change (e.g. cruiser already
        // stands on its target tile). Only claim when the move actually
        // advances us to a new tile.
        this.battlecruiser.setTargetTile(undefined);
        const previousTile = this.battlecruiser.tile();
        this.battlecruiser.move(result.node);
        if (this.battlecruiser.tile() !== previousTile) {
          this.claimTerritoryRadius();
        }
        break;
      }
      case PathStatus.NEXT:
        this.battlecruiser.move(result.node);
        this.claimTerritoryRadius();
        break;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        break;
      }
    }
  }

  /**
   * GDD §14 — the Battlecruiser is a "mobile one-slot planet," so wherever
   * it travels it leaves a permanent territorial wake. For every tile in
   * the Euclidean radius around the cruiser's current position we:
   *   - Promote DeepSpace to AsteroidField (routed through
   *     `Game.setTerrainType` so SectorMap, the deep-space pathfinder dirty
   *     flag, and client terrain sync all stay consistent).
   *   - Conquer unowned sector tiles for the cruiser's owner.
   * Tiles already owned by the cruiser's owner, its allies, or enemies are
   * left alone — combat handles territory flips, not presence alone.
   *
   * The `isAlive()` guard mirrors ScoutSwarmExecution: `conquer()` adds a
   * tile to the player, and `PlayerImpl.isAlive()` is defined as
   * `_tiles.size > 0`. If the owner was eliminated mid-tick, conquering
   * here would revive them with one tile and break the permadeath
   * contract. We still terraform void→sector so the map promotion isn't
   * gated on ownership.
   */
  private claimTerritoryRadius(): void {
    const owner = this.battlecruiser.owner();
    const radius = this.mg.config().battlecruiserTerritoryRadius();
    const tiles = this.mg.circleSearch(this.battlecruiser.tile(), radius);
    for (const tile of tiles) {
      if (this.mg.isDeepSpace(tile)) {
        this.mg.setTerrainType(tile, TerrainType.AsteroidField);
      }
      if (
        this.mg.isSector(tile) &&
        !this.mg.hasOwner(tile) &&
        owner.isAlive()
      ) {
        owner.conquer(tile);
      }
    }
  }

  isActive(): boolean {
    return this.battlecruiser?.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let battlecruiserPatrolRange = this.mg.config().battlecruiserPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;

    // Get battlecruiser's deep space component for connectivity check
    const battlecruiserComponent = this.mg.getDeepSpaceComponent(
      this.battlecruiser.tile(),
    );

    while (expandCount < 3) {
      const x =
        this.mg.x(this.battlecruiser.patrolTile()!) +
        this.random.nextInt(
          -battlecruiserPatrolRange / 2,
          battlecruiserPatrolRange / 2,
        );
      const y =
        this.mg.y(this.battlecruiser.patrolTile()!) +
        this.random.nextInt(
          -battlecruiserPatrolRange / 2,
          battlecruiserPatrolRange / 2,
        );
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isVoid(tile) ||
        (!allowShoreline && this.mg.isSectorBoundary(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          battlecruiserPatrolRange =
            battlecruiserPatrolRange + Math.floor(battlecruiserPatrolRange / 2);
        }
        continue;
      }
      // Check deep space component connectivity
      if (
        battlecruiserComponent !== null &&
        !this.mg.hasDeepSpaceComponent(tile, battlecruiserComponent)
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          battlecruiserPatrolRange =
            battlecruiserPatrolRange + Math.floor(battlecruiserPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for battlecruiser for ${this.battlecruiser.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile in deep space, try again but allow boundary
      return this.randomTile(true);
    }
    return undefined;
  }
}
