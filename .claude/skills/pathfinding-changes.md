---
name: pathfinding-changes
description: Guide to the pathfinding subsystem — A* variants, transformers, spatial queries, and how to add or modify path logic
---

# Pathfinding Changes

All pathfinding code lives in `src/core/pathfinding/`.

## Architecture overview

```
PathFinderBuilder          High-level builder — selects algorithm + transformers
PathFinder.ts              PathFinder interface returned to callers
PathFinder.Air.ts          Air (parabolic trajectory) pathfinder
PathFinder.Parabola.ts     Parabola trajectory (nukes)
PathFinder.Station.ts      Station-to-station routing

algorithms/
  AStar.ts                 Generic A* (configurable cost/heuristic)
  AStar.DeepSpace.ts       A* navigating deep space between sectors
  AStar.DeepSpaceBounded.ts  Deep space A* with a tile-count budget
  AStar.DeepSpaceHierarchical.ts  Two-level hierarchical A* for long routes
  AStar.HyperspaceLane.ts  A* along hyperspace lane graph edges
  AbstractGraph.ts         Graph abstraction over the GameMap
  BFS.Grid.ts              BFS on tile grid
  BFS.ts                   Generic BFS
  ConnectedComponents.ts   Union-find for reachability
  PriorityQueue.ts         Min-heap used by A*

spatial/
  SpatialQuery.ts          Nearby unit / tile proximity lookups (replaces O(n) scans)

transformers/
  ComponentCheckTransformer.ts      Rejects paths that cross disconnected components
  MiniMapTransformer.ts             Scales path from full-res to minimap coordinates
  SectorBoundaryCoercingTransformer.ts  Forces path to start/end at sector boundaries
  SmoothingDeepSpaceTransformer.ts  Smooths jitter in deep-space paths
```

## Choosing the right pathfinder

| Scenario                                | Use                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| Unit moving through sector tiles        | `BFS.Grid`                                              |
| Nuke/projectile parabola arc            | `PathFinder.Parabola`                                   |
| Battlecruiser navigating deep space     | `AStar.DeepSpace` or `AStar.DeepSpaceHierarchical`      |
| Hyperspace lane travel                  | `AStar.HyperspaceLane`                                  |
| Scout Swarm reaching a sector tile      | `AStar.DeepSpace` + `SectorBoundaryCoercingTransformer` |
| "Can these two tiles reach each other?" | `ConnectedComponents`                                   |

## Using `PathFinderBuilder`

```typescript
import { PathFinderBuilder } from "../pathfinding/PathFinderBuilder";

const pathFinder = new PathFinderBuilder(game)
  .forUnit(unit)
  .withTransformer(new SectorBoundaryCoercingTransformer())
  .build();

const path = pathFinder.findPath(sourceTile, destTile);
if (path === null) {
  // no route found
}
```

## Using `SpatialQuery` for nearby units

```typescript
import { SpatialQuery } from "../pathfinding/spatial/SpatialQuery";

// Find all Battlecruisers within radius 5 of a tile
const nearby = game.nearbyUnits(tile, 5, [UnitType.Battlecruiser]);
for (const { unit, distSquared } of nearby) { ... }
```

`game.nearbyUnits()` delegates to `SpatialQuery` — prefer it over iterating all units.

## Adding a new transformer

Transformers post-process a path returned by a base pathfinder. Create
`src/core/pathfinding/transformers/FooTransformer.ts`:

```typescript
export class FooTransformer {
  transform(path: TileRef[]): TileRef[] {
    // Modify or validate the path
    return path;
  }
}
```

Register it in `PathFinderBuilder` or call it directly on the result.

## Tests for pathfinding

- Unit tests: `tests/core/pathfinding/` (mirrors src layout)
- Transformer tests: `tests/core/pathfinding/transformers/`
- Benchmarks: `tests/pathfinding/benchmark/`
- Playground (interactive): `tests/pathfinding/playground/server.ts`
  - Run with: `npx tsx tests/pathfinding/playground/server.ts`

Use the fixtures in `tests/core/pathfinding/_fixtures.ts` for inline small maps — avoids
loading binary test data for simple algorithm tests.

## Key terrain rules for pathfinding

- `isDeepSpace(tile)` — tile is impassable to ground units; only deep-space pathfinders cross it.
- `isSector(tile)` — tile can be owned and traversed by normal ground expansion.
- `isSectorBoundary(tile)` — transition tile; `SectorBoundaryCoercingTransformer` forces paths
  to touch these when entering/exiting sectors.
- `isVoidShore(tile)` — marks the edge where void meets sector; used by shore-aware pathfinders.
- Tile cost is `game.cost(tile)` — varies by terrain type (AsteroidField > Nebula > OpenSpace).

## Gotchas

- `AStar.DeepSpaceHierarchical` caches the sector graph. If you change sector topology (new
  maps, `RecomputeHyperlaneSectorExecution`), the cache must be invalidated.
- `ConnectedComponents` is computed at map load. Do not assume it's live during the game tick.
- Pathfinding runs in the deterministic core — do NOT use `Math.random()` in any pathfinder.
  If you need tie-breaking randomness, thread a `PseudoRandom` instance through.
- `PathFinder.Parabola` uses pre-computed trajectory tiles stored on the `Unit` object.
  The trajectory is set at launch time; the unit just follows the index each tick.
