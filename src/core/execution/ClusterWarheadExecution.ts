import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { NukeExecution } from "./NukeExecution";

/**
 * Max submunitions spawned per game tick once the MRV separates. The full
 * payload (`warheadCount = 350`) used to be added in a single tick, which
 * spiked the executor queue and the render side hard. Spreading the spawns
 * over ~7 ticks (50 × 7 = 350) softens that into a ~700ms arrival window
 * without changing total damage or submunition count.
 *
 * Issue #5 — see plan §6.
 */
const MIRV_SPAWN_PER_TICK = 50;

export class MirvExecution implements Execution {
  private active = true;

  private mg: Game;

  private nuke: Unit | null = null;

  private range = 1500;
  private rangeSquared = this.range * this.range;
  private minimumSpread = 55;
  private warheadCount = 350;

  private baseX: number;
  private baseY: number;

  private random: PseudoRandom;

  private pathFinder: ParabolaUniversalPathFinder;

  private targetPlayer: Player | TerraNullius;

  private separateDst: TileRef;
  private spawnTile: TileRef;

  private speed: number = -1;

  // Submunition destinations selected at separation, then drained
  // `MIRV_SPAWN_PER_TICK` per tick. `pendingIndex` is the cursor into
  // `pendingDestinations`; once it reaches the array length the execution
  // marks itself inactive.
  private pendingDestinations: TileRef[] | null = null;
  private pendingIndex = 0;
  /**
   * Captured at `separate()` (before the warhead Unit is deleted) so the
   * tick-spread drain spawns each submunition from the actual separation
   * point. Using `spawnTile` (the silo) instead would shorten flight time
   * and change interception windows — see Issue #5 verification fix.
   */
  private separateOriginTile: TileRef | null = null;

  constructor(
    private player: Player,
    private dst: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.random = new PseudoRandom(mg.ticks() + simpleHash(this.player.id()));
    this.mg = mg;
    this.targetPlayer = this.mg.owner(this.dst);
    this.speed = this.mg.config().defaultNukeSpeed();
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
    });

    // Betrayal on launch
    if (this.targetPlayer.isPlayer()) {
      const alliance = this.player.allianceWith(this.targetPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (this.targetPlayer !== this.player) {
        this.targetPlayer.updateRelation(this.player, -100);
        this.player.updateRelation(this.targetPlayer, -100);
      }
    }
  }

  tick(ticks: number): void {
    // Drain pending submunition spawns (issue #5 — spread over ~7 ticks).
    if (this.pendingDestinations !== null) {
      this.drainPendingSpawns();
      return;
    }

    if (this.nuke === null) {
      const spawn = this.player.canBuild(UnitType.ClusterWarhead, this.dst);
      if (spawn === false) {
        console.warn(`cannot build ClusterWarhead`);
        this.active = false;
        return;
      }
      this.spawnTile = spawn;
      this.nuke = this.player.buildUnit(UnitType.ClusterWarhead, spawn, {
        targetTile: this.dst,
      });
      this.mg
        .stats()
        .bombLaunch(this.player, this.targetPlayer, UnitType.ClusterWarhead);
      const x = Math.floor(
        (this.mg.x(this.dst) + this.mg.x(this.mg.x(this.nuke.tile()))) / 2,
      );
      const y = Math.max(0, this.mg.y(this.dst) - 500) + 50;
      this.separateDst = this.mg.ref(x, y);

      this.mg.displayIncomingUnit(
        this.nuke.id(),
        "events_display.cluster_warhead_inbound",
        MessageType.CLUSTER_WARHEAD_INBOUND,
        this.targetPlayer.id(),
        { name: this.player.displayName() },
      );
    }

    const result = this.pathFinder.next(
      this.spawnTile,
      this.separateDst,
      this.speed,
    );
    if (result.status === PathStatus.COMPLETE) {
      this.separate();
      // Record stats
      this.mg
        .stats()
        .bombLand(this.player, this.targetPlayer, UnitType.ClusterWarhead);
      return;
    } else if (result.status === PathStatus.NEXT) {
      this.nuke.move(result.node);
    }
  }

  private separate() {
    if (this.nuke === null) {
      throw new Error("uninitialized");
    }

    this.baseX = this.mg.x(this.dst);
    this.baseY = this.mg.y(this.dst);

    // Capture the warhead's current tile BEFORE deletion so submunitions
    // still spawn from the separation point. Reading `this.nuke.tile()`
    // after `delete(false)` is unsafe, and falling back to `this.spawnTile`
    // (the silo) would shrink each submunition's flight to the silo→target
    // arc instead of the separation→target arc — changing damage timing
    // and interception windows.
    this.separateOriginTile = this.nuke.tile();

    // Pre-compute the destination list, then let `drainPendingSpawns` add
    // submunition executions a slice at a time across subsequent ticks.
    this.pendingDestinations = this.selectDestinations();
    this.pendingIndex = 0;
    this.nuke.delete(false);
  }

  private drainPendingSpawns(): void {
    const destinations = this.pendingDestinations!;
    const nukeTile = this.separateOriginTile ?? this.spawnTile;
    const start = this.pendingIndex;
    const end = Math.min(destinations.length, start + MIRV_SPAWN_PER_TICK);
    const total = this.warheadCount;
    for (let i = start; i < end; i++) {
      this.mg.addExecution(
        new NukeExecution(
          UnitType.ClusterWarheadSubmunition,
          this.player,
          destinations[i],
          nukeTile,
          15 + Math.floor((i / total) * 5),
          this.random.nextInt(0, 15),
        ),
      );
    }
    this.pendingIndex = end;
    if (this.pendingIndex >= destinations.length) {
      this.pendingDestinations = null;
      this.active = false;
    }
  }

  private selectDestinations(): TileRef[] {
    const targets: TileRef[] = [this.dst];
    // Spatial grid keyed by `(cellX, cellY)` so the overlap check is O(9-ish
    // neighbors) instead of O(taken.length). Cell size = `minimumSpread`
    // means any candidate within Manhattan distance < minimumSpread of an
    // already-taken tile must live in one of the 9 surrounding cells.
    const grid = new Map<number, number[]>();
    const cellSize = this.minimumSpread;
    const addToGrid = (gx: number, gy: number, tile: TileRef): void => {
      const cellKey = gx * 65536 + gy;
      let bucket = grid.get(cellKey);
      if (bucket === undefined) {
        bucket = [];
        grid.set(cellKey, bucket);
      }
      bucket.push(tile);
    };
    // Seed the grid with the initial dst tile.
    addToGrid(
      Math.floor(this.baseX / cellSize),
      Math.floor(this.baseY / cellSize),
      this.dst,
    );

    for (let attempt = 0; attempt < 1000; attempt++) {
      const generated = this.tryGenerateTarget(grid, cellSize);
      if (generated !== undefined) {
        targets.push(generated.tile);
        addToGrid(generated.cellX, generated.cellY, generated.tile);
      }
      if (targets.length >= this.warheadCount) break;
    }

    return targets.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
    );
  }

  private tryGenerateTarget(
    grid: Map<number, number[]>,
    cellSize: number,
  ):
    | {
        tile: TileRef;
        cellX: number;
        cellY: number;
      }
    | undefined {
    for (let attempt = 0; attempt < 100; attempt++) {
      const r1 = this.random.next();
      const r2 = (r1 * 15485863) % 1;

      const x = Math.round(r1 * this.range * 2 - this.range + this.baseX);
      const y = Math.round(r2 * this.range * 2 - this.range + this.baseY);

      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }

      // Cache `mg.ref(x, y)` once per candidate (was previously recomputed
      // by isSector + owner via separate calls).
      const tile = this.mg.ref(x, y);

      if (!this.mg.isSector(tile)) {
        continue;
      }

      if ((x - this.baseX) ** 2 + (y - this.baseY) ** 2 > this.rangeSquared) {
        continue;
      }

      if (this.mg.owner(tile) !== this.targetPlayer) {
        continue;
      }

      if (this.isOverlappingGrid(x, y, grid, cellSize)) {
        continue;
      }

      return {
        tile,
        cellX: Math.floor(x / cellSize),
        cellY: Math.floor(y / cellSize),
      };
    }
    return undefined;
  }

  private isOverlappingGrid(
    x: number,
    y: number,
    grid: Map<number, number[]>,
    cellSize: number,
  ): boolean {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get((cx + dx) * 65536 + (cy + dy));
        if (bucket === undefined) continue;
        for (let i = 0; i < bucket.length; i++) {
          const t = bucket[i];
          const tx = this.mg.x(t);
          const ty = this.mg.y(t);
          if (Math.abs(x - tx) + Math.abs(y - ty) < this.minimumSpread) {
            return true;
          }
        }
      }
    }
    return false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
