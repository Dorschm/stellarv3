import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
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
    this.pathfinder = PathFinding.Water(mg);
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

    const hasPort =
      this.battlecruiser.owner().unitCount(UnitType.Spaceport) > 0;
    if (hasPort) {
      this.battlecruiser.modifyHealth(1);
    }

    this.battlecruiser.setTargetUnit(this.findTargetUnit());
    if (this.battlecruiser.targetUnit()?.type() === UnitType.TradeFreighter) {
      this.huntDownTradeFreighter();
      return;
    }

    this.patrol();

    if (this.battlecruiser.targetUnit() !== undefined) {
      this.shootTarget();
      return;
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
          this.battlecruiser
            .owner()
            .captureUnit(this.battlecruiser.targetUnit()!);
          this.battlecruiser.setTargetUnit(undefined);
          this.battlecruiser.move(this.battlecruiser.tile());
          return;
        case PathStatus.NEXT:
          this.battlecruiser.move(result.node);
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
      case PathStatus.COMPLETE:
        this.battlecruiser.setTargetTile(undefined);
        this.battlecruiser.move(result.node);
        break;
      case PathStatus.NEXT:
        this.battlecruiser.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        break;
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
