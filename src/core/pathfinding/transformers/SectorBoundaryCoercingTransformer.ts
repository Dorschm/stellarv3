import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

/**
 * Wraps a PathFinder to handle shore tiles.
 * Coerces shore tiles to nearby water tiles before pathfinding,
 * then fixes the path extremes to include the original shore tiles.
 */
export class SectorBoundaryCoercingTransformer implements PathFinder<number> {
  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const fromArray = Array.isArray(from) ? from : [from];
    const waterToOriginal = new Map<TileRef, TileRef | null>();
    const waterFrom: TileRef[] = [];

    for (const f of fromArray) {
      const coerced = this.coerceToWater(f);
      if (coerced.water !== null) {
        waterFrom.push(coerced.water);
        waterToOriginal.set(coerced.water, coerced.original);
      }
    }

    if (waterFrom.length === 0) {
      return null;
    }

    const coercedTo = this.coerceToWater(to);
    if (coercedTo.water === null) {
      return null;
    }

    const fromTiles = waterFrom.length === 1 ? waterFrom[0] : waterFrom;
    const path = this.inner.findPath(fromTiles, coercedTo.water);
    if (!path || path.length === 0) {
      return null;
    }

    // Restore original start shore tile
    const originalShore = waterToOriginal.get(path[0]);
    if (originalShore !== undefined && originalShore !== null) {
      path.unshift(originalShore);
    }

    // Append original to if different
    if (
      coercedTo.original !== null &&
      path[path.length - 1] !== coercedTo.original
    ) {
      path.push(coercedTo.original);
    }

    return path;
  }

  /**
   * Coerce a tile to water for pathfinding.
   * If tile is already water, returns it unchanged.
   * If tile is shore, finds the best adjacent water neighbor.
   * If no direct neighbor is water (e.g. the tile sits inside a sector
   * bubble produced by Battlecruiser territory claims), falls back to a
   * bounded BFS outward and returns the nearest deep-space tile found.
   */
  private coerceToWater(tile: TileRef): {
    water: TileRef | null;
    original: TileRef | null;
  } {
    if (this.map.isDeepSpace(tile)) {
      return { water: tile, original: null };
    }

    let best: TileRef | null = null;
    let maxScore = -1;

    for (const n of this.map.neighbors(tile)) {
      if (!this.map.isDeepSpace(n)) continue;

      // Score by water neighbor count (connectivity)
      const score = this.countDeepSpaceNeighbors(n);

      // Pick highest connectivity
      if (score > maxScore) {
        maxScore = score;
        best = n;
      }
    }

    if (best !== null) {
      return { water: best, original: tile };
    }

    // Fallback: no direct deep-space neighbor. The start tile may sit
    // inside a sector bubble (e.g. a Battlecruiser's claim radius has
    // converted every immediate neighbor into sector). Search outward by
    // BFS for the nearest deep-space tile so subsequent path queries can
    // still produce a route instead of silently returning null.
    const farWater = this.bfsNearestDeepSpace(tile);
    if (farWater !== null) {
      return { water: farWater, original: tile };
    }
    return { water: null, original: tile };
  }

  private countDeepSpaceNeighbors(tile: TileRef): number {
    let count = 0;
    for (const n of this.map.neighbors(tile)) {
      if (this.map.isDeepSpace(n)) count++;
    }
    return count;
  }

  /**
   * Bounded BFS outward from `start` that returns the first deep-space
   * tile encountered (nearest by tile-step distance). `map.neighbors()`
   * returns a fixed order (up, down, left, right), so the traversal is
   * deterministic across client and server. MAX_VISITED caps the search
   * so a pathological closed sector region (e.g. a fully-enclosed
   * Station) cannot degrade a path query into a full-map scan.
   */
  private bfsNearestDeepSpace(start: TileRef): TileRef | null {
    const MAX_VISITED = 4096;
    const seen = new Set<TileRef>();
    const queue: TileRef[] = [start];
    seen.add(start);

    let head = 0;
    while (head < queue.length && seen.size < MAX_VISITED) {
      const curr = queue[head++];
      for (const n of this.map.neighbors(curr)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (this.map.isDeepSpace(n)) {
          return n;
        }
        queue.push(n);
      }
    }
    return null;
  }
}
