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

  // ── Perf: spread sub-warhead spawning across multiple ticks ──
  // The original `separate()` instantiated all 350 NukeExecution objects
  // (and called `mg.addExecution` 350 times) in a single tick. That spike
  // froze the simulation for users running on weaker hardware. We now
  // drain ~PER_TICK_SPAWN_BUDGET sub-warheads per subsequent tick and
  // pre-compute per-warhead random offsets up-front so the global random
  // sequence stays bit-identical to the legacy single-tick path.
  private static readonly PER_TICK_SPAWN_BUDGET = 50;
  private pendingDestinations: TileRef[] | null = null;
  private pendingOffsets: Int32Array | null = null;
  private spawnedCount = 0;
  private spawnSourceTile: TileRef | null = null;

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

    // Drain phase: post-separate, sub-warheads are spawned ~50 per tick.
    if (this.pendingDestinations !== null) {
      this.flushPendingSpawns();
      if (this.spawnedCount >= this.pendingDestinations.length) {
        this.pendingDestinations = null;
        this.pendingOffsets = null;
        this.active = false;
      }
      return;
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

    const destinations = this.selectDestinations();

    // Pre-consume the per-warhead random offsets up-front so the global
    // random sequence is identical to the legacy single-tick spawn path.
    // The drain loop below reads from `pendingOffsets` instead of
    // calling `random.nextInt` per-tick — interleaving random draws with
    // any other simulation consumer would break determinism.
    const offsets = new Int32Array(destinations.length);
    for (let i = 0; i < destinations.length; i++) {
      offsets[i] = this.random.nextInt(0, 15);
    }

    // Capture the source tile and tear down the parent missile NOW —
    // sub-warhead spawning happens over the next several ticks and we
    // can't re-read `this.nuke` once it's deleted.
    this.spawnSourceTile = this.nuke.tile();
    this.nuke.delete(false);

    this.pendingDestinations = destinations;
    this.pendingOffsets = offsets;
    this.spawnedCount = 0;
  }

  private flushPendingSpawns(): void {
    if (
      this.pendingDestinations === null ||
      this.pendingOffsets === null ||
      this.spawnSourceTile === null
    ) {
      return;
    }
    const total = this.pendingDestinations.length;
    const remaining = total - this.spawnedCount;
    const budget = Math.min(MirvExecution.PER_TICK_SPAWN_BUDGET, remaining);
    for (let i = 0; i < budget; i++) {
      const overallIndex = this.spawnedCount + i;
      const dst = this.pendingDestinations[overallIndex];
      this.mg.addExecution(
        new NukeExecution(
          UnitType.ClusterWarheadSubmunition,
          this.player,
          dst,
          this.spawnSourceTile,
          15 + Math.floor((overallIndex / this.warheadCount) * 5),
          this.pendingOffsets[overallIndex],
        ),
      );
    }
    this.spawnedCount += budget;
  }

  private selectDestinations(): TileRef[] {
    const targets: TileRef[] = [this.dst];

    // Spatial hash grid for O(1)-ish overlap rejection. Bucket size
    // equals `minimumSpread` so any same-bucket tile is automatically a
    // collision; only the bucket + 8 neighbours need to be scanned for
    // candidates within minimumSpread Manhattan distance.
    const cellSize = this.minimumSpread;
    const grid = new Map<string, { x: number; y: number }[]>();
    this.addToGrid(grid, cellSize, this.baseX, this.baseY);

    // Keep the outer cap at 1000 attempts (legacy value) so the
    // PseudoRandom sequence consumed by `tryGenerateTarget` is bit-identical
    // to the pre-perf path. The spatial grid below is what makes this loop
    // cheap — not a smaller cap.
    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = this.tryGenerateTarget(grid, cellSize);
      if (candidate !== undefined) {
        targets.push(candidate.tile);
        this.addToGrid(grid, cellSize, candidate.x, candidate.y);
      }
      if (targets.length >= this.warheadCount) break;
    }

    return targets.sort(
      (a, b) =>
        this.mg.manhattanDist(b, this.dst) - this.mg.manhattanDist(a, this.dst),
    );
  }

  private tryGenerateTarget(
    grid: Map<string, { x: number; y: number }[]>,
    cellSize: number,
  ): { tile: TileRef; x: number; y: number } | undefined {
    for (let attempt = 0; attempt < 100; attempt++) {
      const r1 = this.random.next();
      const r2 = (r1 * 15485863) % 1;

      const x = Math.round(r1 * this.range * 2 - this.range + this.baseX);
      const y = Math.round(r2 * this.range * 2 - this.range + this.baseY);

      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      if ((x - this.baseX) ** 2 + (y - this.baseY) ** 2 > this.rangeSquared) {
        continue;
      }

      // Single ref() decode per candidate — the legacy code resolved
      // (x,y) → tile and then later re-decoded `taken` TileRefs back to
      // (x,y) inside the overlap loop. Caching coordinates here lets the
      // grid check skip that round-trip entirely.
      const tile = this.mg.ref(x, y);
      if (!this.mg.isSector(tile)) {
        continue;
      }
      if (this.mg.owner(tile) !== this.targetPlayer) {
        continue;
      }
      if (this.isOverlapping(grid, cellSize, x, y)) {
        continue;
      }

      return { tile, x, y };
    }
    return undefined;
  }

  private addToGrid(
    grid: Map<string, { x: number; y: number }[]>,
    cellSize: number,
    x: number,
    y: number,
  ): void {
    const key = this.cellKey(cellSize, x, y);
    let bucket = grid.get(key);
    if (bucket === undefined) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push({ x, y });
  }

  private cellKey(cellSize: number, x: number, y: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  }

  private isOverlapping(
    grid: Map<string, { x: number; y: number }[]>,
    cellSize: number,
    x: number,
    y: number,
  ): boolean {
    const bx = Math.floor(x / cellSize);
    const by = Math.floor(y / cellSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(`${bx + dx},${by + dy}`);
        if (bucket === undefined) continue;
        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          if (Math.abs(x - c.x) + Math.abs(y - c.y) < this.minimumSpread) {
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
