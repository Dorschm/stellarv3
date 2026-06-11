import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { AbstractGraph } from "../../../src/core/pathfinding/algorithms/AbstractGraph";
import { AStarDeepSpaceHierarchical } from "../../../src/core/pathfinding/algorithms/AStar.DeepSpaceHierarchical";

const DEEP_SPACE_BIT = 0x20;
const CLUSTER_SIZE = 64;

function createDeepSpaceMap(width: number, height: number): GameMapImpl {
  // All-deep-space map: every tile is passable for the bounded A*.
  const terrain = new Uint8Array(width * height).fill(DEEP_SPACE_BIT);
  return new GameMapImpl(width, height, terrain, 0);
}

function createPathFinder(map: GameMapImpl): AStarDeepSpaceHierarchical {
  // Empty abstract graph: if the short-path bounded search rejects the
  // query (e.g. its preallocated area is smaller than the requested
  // bounds), the hierarchical fallback hits the empty graph and
  // findPath returns null — making fast-path coverage observable.
  const graph = new AbstractGraph(
    CLUSTER_SIZE,
    Math.ceil(map.width() / CLUSTER_SIZE),
    Math.ceil(map.height() / CLUSTER_SIZE),
  );
  return new AStarDeepSpaceHierarchical(map, graph);
}

// Regression tests for the short-path multi-source fast path: the
// preallocated search area must cover the worst-case candidate bounding
// box of target ± SHORT_PATH_THRESHOLD (120) plus SHORT_PATH_PADDING
// (10) per side — 261 tiles per axis inclusive, not 260.
describe("AStarDeepSpaceHierarchical short-path multi-source fast path", () => {
  it("handles the worst-case candidate spread at the threshold on all four sides of the target", () => {
    const map = createDeepSpaceMap(280, 280);
    const pf = createPathFinder(map);

    const target = map.ref(140, 140);
    // Candidates exactly at the manhattan threshold (120) on all four
    // sides: the padded bounding box spans 2 * (120 + 10) + 1 = 261
    // tiles per axis, the maximum the fast path can be asked to search.
    const sources = [
      map.ref(20, 140),
      map.ref(260, 140),
      map.ref(140, 20),
      map.ref(140, 260),
    ];

    const path = pf.findPath(sources, target);
    expect(path).not.toBeNull();
    expect(sources).toContain(path![0]);
    expect(path![path!.length - 1]).toBe(target);
  });

  it("clamps the short-path bounds at map edges", () => {
    const map = createDeepSpaceMap(280, 280);
    const pf = createPathFinder(map);

    // Target near the corner: the padded bounds are clamped to the map
    // and stay within the preallocated search area.
    const target = map.ref(5, 5);
    const sources = [map.ref(0, 0), map.ref(125, 5), map.ref(5, 125)];

    const path = pf.findPath(sources, target);
    expect(path).not.toBeNull();
    expect(sources).toContain(path![0]);
    expect(path![path!.length - 1]).toBe(target);
  });
});
