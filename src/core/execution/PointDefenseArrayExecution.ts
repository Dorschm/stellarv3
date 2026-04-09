import {
  Execution,
  Game,
  isUnit,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { PointDefenseMissileExecution } from "./PointDefenseMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

/**
 * Smart PDA targeting system preshoting nukes so its range is strictly enforced
 */
class PDATargetingSystem {
  // Interception tiles are computed a single time, but it may not be reachable yet.
  // Store the result so it can be intercepted at the proper time, rather than recomputing each tick.
  // Null interception tile means there are no interception tiles in range. Store it to avoid recomputing.
  private readonly precomputedNukes: Map<number, InterceptionTile | null> =
    new Map();
  private readonly missileSpeed: number;

  constructor(
    private readonly mg: Game,
    private readonly pda: Unit,
  ) {
    this.missileSpeed = this.mg.config().defaultPointDefenseMissileSpeed();
  }

  updateUnreachableNukes(nearbyUnits: { unit: Unit; distSquared: number }[]) {
    if (this.precomputedNukes.size === 0) {
      return;
    }

    // Avoid per-tick allocations for the common case where only a few nukes are tracked.
    if (this.precomputedNukes.size <= 16) {
      for (const nukeId of this.precomputedNukes.keys()) {
        let found = false;
        for (const u of nearbyUnits) {
          if (u.unit.id() === nukeId) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.precomputedNukes.delete(nukeId);
        }
      }
      return;
    }

    const nearbyUnitSet = new Set<number>();
    for (const u of nearbyUnits) {
      nearbyUnitSet.add(u.unit.id());
    }
    for (const nukeId of this.precomputedNukes.keys()) {
      if (!nearbyUnitSet.has(nukeId)) {
        this.precomputedNukes.delete(nukeId);
      }
    }
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    return Math.ceil(
      this.mg.manhattanDist(currentTile, tile) / this.missileSpeed,
    );
  }

  private computeInterceptionTile(
    unit: Unit,
    pdaTile: TileRef,
    rangeSquared: number,
  ): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const currentIndex = unit.trajectoryIndex();
    const explosionTick: number = trajectory.length - currentIndex;
    for (let i = currentIndex; i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (
        trajectoryTile.targetable &&
        this.mg.euclideanDistSquared(pdaTile, trajectoryTile.tile) <=
          rangeSquared
      ) {
        const nukeTickToReach = i - currentIndex;
        const pdaTickToReach = this.tickToReach(pdaTile, trajectoryTile.tile);
        const tickBeforeShooting = nukeTickToReach - pdaTickToReach;
        if (pdaTickToReach < explosionTick && tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: trajectoryTile.tile };
        }
      }
    }
    return undefined;
  }

  public getSingleTarget(ticks: number): Target | null {
    const pdaTile = this.pda.tile();
    const range = this.mg.config().pointDefenseRange(this.pda.level());
    const rangeSquared = range * range;

    // Look beyond the PDA range so it can preshot nukes
    const detectionRange = this.mg.config().maxPointDefenseRange() * 2;
    const nukes = this.mg.nearbyUnits(
      pdaTile,
      detectionRange,
      [UnitType.AntimatterTorpedo, UnitType.NovaBomb],
      ({ unit }) => {
        if (!isUnit(unit) || unit.targetedByPointDefense()) return false;
        if (unit.owner() === this.pda.owner()) return false;

        const pdaOwner = this.pda.owner();
        const nukeOwner = unit.owner();

        // After game-over in team games, PDAs also target teammate nukes (aftergame fun)
        if (pdaOwner.isFriendly(nukeOwner)) {
          return (
            this.mg.getWinner() !== null && pdaOwner.isOnSameTeam(nukeOwner)
          );
        }

        return true;
      },
    );

    // Clear unreachable nukes that went out of range
    this.updateUnreachableNukes(nukes);

    let best: Target | null = null;
    for (const nuke of nukes) {
      const nukeId = nuke.unit.id();
      const cached = this.precomputedNukes.get(nukeId);
      if (cached !== undefined) {
        if (cached === null) {
          // Already computed as unreachable, skip
          continue;
        }
        if (cached.tick === ticks) {
          // Time to shoot!
          const target = { tile: cached.tile, unit: nuke.unit };
          if (
            best === null ||
            (target.unit.type() === UnitType.NovaBomb &&
              best.unit.type() !== UnitType.NovaBomb)
          ) {
            best = target;
          }
          this.precomputedNukes.delete(nukeId);
          continue;
        }
        if (cached.tick > ticks) {
          // Not due yet, skip for now.
          continue;
        }
        // Missed the planned tick (e.g was on cooldown), recompute a new interception tile if possible
        this.precomputedNukes.delete(nukeId);
      }
      const interceptionTile = this.computeInterceptionTile(
        nuke.unit,
        pdaTile,
        rangeSquared,
      );
      if (interceptionTile !== undefined) {
        if (interceptionTile.tick <= 1) {
          // Shoot instantly

          const target = { unit: nuke.unit, tile: interceptionTile.tile };
          if (
            best === null ||
            (target.unit.type() === UnitType.NovaBomb &&
              best.unit.type() !== UnitType.NovaBomb)
          ) {
            best = target;
          }
        } else {
          // Nuke will be reachable but not yet. Store the result.
          this.precomputedNukes.set(nukeId, {
            tick: interceptionTile.tick + ticks,
            tile: interceptionTile.tile,
          });
        }
      } else {
        // Store unreachable nukes in order to prevent useless interception computation
        this.precomputedNukes.set(nukeId, null);
      }
    }

    return best;
  }
}

export class PointDefenseArrayExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // As cluster warheads go very fast we have to detect them very early but we only
  // shoot the one targeting very close (clusterWarheadProtectionRadius)
  private clusterWarheadSearchRadius = 400;
  private clusterWarheadProtectionRadius = 50;
  private targetingSystem: PDATargetingSystem;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private pda: Unit | null = null,
  ) {
    if (pda !== null) {
      this.tile = pda.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    if (this.pda === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(
        UnitType.PointDefenseArray,
        this.tile,
      );
      if (spawnTile === false) {
        console.warn("cannot build PDA");
        this.active = false;
        return;
      }
      this.pda = this.player.buildUnit(
        UnitType.PointDefenseArray,
        spawnTile,
        {},
      );
    }
    this.targetingSystem ??= new PDATargetingSystem(this.mg, this.pda);

    if (this.pda.isUnderConstruction()) {
      return;
    }

    if (this.pda.isInCooldown()) {
      const frontTime = this.pda.missileTimerQueue()[0];
      if (frontTime === undefined) {
        return;
      }
      const cooldown =
        this.mg.config().pointDefenseCooldown() - (this.mg.ticks() - frontTime);

      if (cooldown <= 0) {
        this.pda.reloadMissile();
      }
      return;
    }

    if (!this.pda.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.pda.owner()) {
      this.player = this.pda.owner();
    }

    this.pseudoRandom ??= new PseudoRandom(this.pda.id());

    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.pda.tile(),
      this.clusterWarheadSearchRadius,
      UnitType.ClusterWarheadSubmunition,
      ({ unit }) => {
        if (!isUnit(unit)) return false;
        if (unit.owner() === this.player) return false;

        // After game-over in team games, PDAs also target teammate cluster warheads (aftergame fun)
        const nukeOwner = unit.owner();
        if (this.player.isFriendly(nukeOwner)) {
          if (
            this.mg.getWinner() === null ||
            !this.player.isOnSameTeam(nukeOwner)
          ) {
            return false;
          }
        }

        const dst = unit.targetTile();
        return (
          this.pda !== null &&
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.pda.tile()) <
            this.clusterWarheadProtectionRadius
        );
      },
    );

    let target: Target | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.targetingSystem.getSingleTarget(ticks);
      if (target !== null) {
        console.log("Target acquired");
      }
    }

    // target is already filtered to exclude nukes targeted by other PDAs
    if (target || mirvWarheadTargets.length > 0) {
      this.pda.launch();
      const type =
        mirvWarheadTargets.length > 0
          ? UnitType.ClusterWarheadSubmunition
          : target?.unit.type();
      if (type === undefined) throw new Error("Unknown unit type");
      if (mirvWarheadTargets.length > 0) {
        const pdaOwner = this.pda.owner();

        // Message
        this.mg.displayMessage(
          "events_display.mirv_warheads_intercepted",
          MessageType.POINT_DEFENSE_HIT,
          pdaOwner.id(),
          undefined,
          { count: mirvWarheadTargets.length },
        );

        mirvWarheadTargets.forEach(({ unit: u }) => {
          // Delete warheads
          u.delete();
        });

        // Record stats
        this.mg
          .stats()
          .bombIntercept(
            pdaOwner,
            UnitType.ClusterWarheadSubmunition,
            mirvWarheadTargets.length,
          );
      } else if (target !== null) {
        target.unit.setTargetedByPointDefense(true);
        this.mg.addExecution(
          new PointDefenseMissileExecution(
            this.pda.tile(),
            this.pda.owner(),
            this.pda,
            target.unit,
            target.tile,
          ),
        );
      } else {
        throw new Error("target is null");
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
