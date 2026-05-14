import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";
import { MinHeap, PriorityQueue } from "./PriorityQueue";

const SECTOR_BIT = 7; // Bit 7 in terrain indicates a sector tile
const MAGNITUDE_MASK = 0x1f;
// `GameMapImpl.state[i] & PLAYER_ID_MASK` is the tile's owner small-ID.
// Kept locally so the pathfinder's inner loop avoids importing
// `GameMapImpl` (and a circular dep with the game module).
const PLAYER_ID_MASK = 0xfff;
const COST_SCALE = 100;
const BASE_COST = 1 * COST_SCALE;

// Prefer magnitude 3-10 (3-10 tiles from shore)
function getMagnitudePenalty(magnitude: number): number {
  if (magnitude < 3) return 10 * COST_SCALE; // too close to shore
  if (magnitude <= 10) return 0; // sweet spot
  return 1 * COST_SCALE; // deep water, slight penalty
}

export interface AStarDeepSpaceConfig {
  heuristicWeight?: number;
  maxIterations?: number;
  /**
   * Capital-ship territory wake (Issue: cruiser can't traverse its own
   * flipped tiles). When set to a non-zero small-ID, sector tiles owned
   * by that small-ID are treated as passable in addition to non-sector
   * (deep-space) tiles. Read via a getter so the cruiser can swap owners
   * mid-run (e.g. captureUnit) without rebuilding the pathfinder.
   *
   * Returns `0` (or omitting the getter) disables the override and the
   * pathfinder behaves identically to the original deep-space-only A*.
   */
  passableOwnerSmallID?: () => number;
}

export class AStarDeepSpace implements PathFinder<number> {
  private stamp = 1;

  private readonly closedStamp: Uint32Array;
  private readonly gScoreStamp: Uint32Array;
  private readonly gScore: Uint32Array;
  private readonly cameFrom: Int32Array;
  private readonly queue: PriorityQueue;
  private readonly terrain: Uint8Array;
  private readonly state: Uint16Array | null;
  private readonly width: number;
  private readonly numNodes: number;
  private readonly heuristicWeight: number;
  private readonly maxIterations: number;
  private readonly passableOwnerSmallIDGetter: (() => number) | null;

  constructor(map: GameMap, config?: AStarDeepSpaceConfig) {
    this.terrain = (map as any).terrain as Uint8Array;
    // `state` is the Uint16Array holding per-tile ownership (low 12 bits
    // = player small-ID). Only required when the owner-passable override
    // is in use; otherwise we leave it `null` and pay no per-tile state
    // lookup cost.
    this.state =
      config?.passableOwnerSmallID !== undefined
        ? ((map as any).state as Uint16Array)
        : null;
    this.width = map.width();
    this.numNodes = map.width() * map.height();
    this.heuristicWeight = config?.heuristicWeight ?? 5;
    this.maxIterations = config?.maxIterations ?? 1_000_000;
    this.passableOwnerSmallIDGetter = config?.passableOwnerSmallID ?? null;

    this.closedStamp = new Uint32Array(this.numNodes);
    this.gScoreStamp = new Uint32Array(this.numNodes);
    this.gScore = new Uint32Array(this.numNodes);
    this.cameFrom = new Int32Array(this.numNodes);

    this.queue = new MinHeap(this.numNodes);
  }

  findPath(start: number | number[], goal: number): number[] | null {
    this.stamp++;
    if (this.stamp > 0xffffffff) {
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    const stamp = this.stamp;
    const width = this.width;
    const numNodes = this.numNodes;
    const terrain = this.terrain;
    const closedStamp = this.closedStamp;
    const gScoreStamp = this.gScoreStamp;
    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const queue = this.queue;
    const weight = this.heuristicWeight;
    const sectorMask = 1 << SECTOR_BIT;
    // Resolve the owner-passable override once per findPath() — cruisers
    // call this on every patrol step, but ownership changes (captureUnit)
    // are rare. Pulling it out of the inner neighbor check keeps the hot
    // loop a single straight-line branch.
    const state = this.state;
    const passableOwnerSmallID =
      this.passableOwnerSmallIDGetter !== null
        ? this.passableOwnerSmallIDGetter()
        : 0;
    const ownerOverrideEnabled = state !== null && passableOwnerSmallID !== 0;

    const goalX = goal % width;
    const goalY = (goal / width) | 0;

    queue.clear();
    const starts = Array.isArray(start) ? start : [start];

    // For cross-product tie-breaker (prefer diagonal paths)
    const s0 = starts[0];
    const startX = s0 % width;
    const startY = (s0 / width) | 0;
    const dxGoal = goalX - startX;
    const dyGoal = goalY - startY;
    // Normalization factor to keep tie-breaker small (< COST_SCALE)
    const crossNorm = Math.max(1, Math.abs(dxGoal) + Math.abs(dyGoal));

    // Cross-product tie-breaker: measures deviation from start-goal line
    const crossTieBreaker = (nx: number, ny: number): number => {
      const dxN = nx - goalX;
      const dyN = ny - goalY;
      const cross = Math.abs(dxGoal * dyN - dyGoal * dxN);
      return Math.floor((cross * (COST_SCALE - 1)) / crossNorm / crossNorm);
    };

    for (const s of starts) {
      gScore[s] = 0;
      gScoreStamp[s] = stamp;
      cameFrom[s] = -1;
      const sx = s % width;
      const sy = (s / width) | 0;
      const h =
        weight * BASE_COST * (Math.abs(sx - goalX) + Math.abs(sy - goalY));
      queue.push(s, h);
    }

    let iterations = this.maxIterations;

    while (!queue.isEmpty()) {
      if (--iterations <= 0) {
        return null;
      }

      const current = queue.pop();

      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;

      if (current === goal) {
        return this.buildPath(goal);
      }

      const currentG = gScore[current];
      const currentX = current % width;
      const currentY = (current / width) | 0;

      if (current >= width) {
        const neighbor = current - width;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal ||
            (neighborTerrain & sectorMask) === 0 ||
            (ownerOverrideEnabled &&
              (state![neighbor] & PLAYER_ID_MASK) === passableOwnerSmallID))
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const ny = currentY - 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(currentX - goalX) + Math.abs(ny - goalY));
            const f = tentativeG + h + crossTieBreaker(currentX, ny);
            queue.push(neighbor, f);
          }
        }
      }

      if (current < numNodes - width) {
        const neighbor = current + width;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal ||
            (neighborTerrain & sectorMask) === 0 ||
            (ownerOverrideEnabled &&
              (state![neighbor] & PLAYER_ID_MASK) === passableOwnerSmallID))
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const ny = currentY + 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(currentX - goalX) + Math.abs(ny - goalY));
            const f = tentativeG + h + crossTieBreaker(currentX, ny);
            queue.push(neighbor, f);
          }
        }
      }

      if (currentX !== 0) {
        const neighbor = current - 1;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal ||
            (neighborTerrain & sectorMask) === 0 ||
            (ownerOverrideEnabled &&
              (state![neighbor] & PLAYER_ID_MASK) === passableOwnerSmallID))
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const nx = currentX - 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(nx - goalX) + Math.abs(currentY - goalY));
            const f = tentativeG + h + crossTieBreaker(nx, currentY);
            queue.push(neighbor, f);
          }
        }
      }

      if (currentX !== width - 1) {
        const neighbor = current + 1;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal ||
            (neighborTerrain & sectorMask) === 0 ||
            (ownerOverrideEnabled &&
              (state![neighbor] & PLAYER_ID_MASK) === passableOwnerSmallID))
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const nx = currentX + 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(nx - goalX) + Math.abs(currentY - goalY));
            const f = tentativeG + h + crossTieBreaker(nx, currentY);
            queue.push(neighbor, f);
          }
        }
      }
    }

    return null;
  }

  private buildPath(goal: number): TileRef[] {
    const path: TileRef[] = [];
    let current = goal;

    while (current !== -1) {
      path.push(current as TileRef);
      current = this.cameFrom[current];
    }

    path.reverse();
    return path;
  }
}
