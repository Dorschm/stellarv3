import { beforeEach, describe, expect, it } from "vitest";
import { Game, TerrainType } from "../../../src/core/game/Game";
import { PathFinding } from "../../../src/core/pathfinding/PathFinder";
import { setup } from "../../util/Setup";

// Regression tests for the consume-on-read deep-space dirty flag.
// There is one DeepSpaceRuntimeSwitchingPathFinder per in-flight unit,
// and the first instance to query after a void→sector promotion
// consumes the game-global dirty flag. The staleness it signals must
// remain visible to every OTHER instance and on every LATER tick — the
// HPA graph is built once at game init and never rebuilt, so it stays
// stale for the remainder of the game.
describe("DeepSpace stale-HPA consistency across pathfinder instances", () => {
  let game: Game;
  let hpaCalls: number;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
    // The fixture map is too small to build a real HPA graph, so stub
    // one in: a graph that passes the size gate (nodeCount >= 100) and
    // an inner pathfinder that records each query and fails it. Any
    // query that reaches the stub means the wrapper wrongly trusted
    // the stale HPA cache after a promotion.
    hpaCalls = 0;
    (game as any).miniDeepSpaceGraph = () => ({
      nodeCount: 1000,
      getComponentId: () => 1,
    });
    (game as any).miniDeepSpaceHPA = () => ({
      findPath: () => {
        hpaCalls++;
        return null;
      },
    });
  });

  function promote(): number {
    const voidTile = game.ref(9, 0);
    expect(game.map().isVoid(voidTile)).toBe(true);
    game.setTerrainType(voidTile, TerrainType.AsteroidField);
    expect(game.isDeepSpaceGraphDirty()).toBe(true);
    return voidTile;
  }

  it("a second instance routes via the simple fallback after another instance consumed the dirty flag", () => {
    const map = game.map();
    const from = map.ref(8, 1);
    const to = map.ref(15, 4);

    const pfA = PathFinding.DeepSpace(game);
    const pfB = PathFinding.DeepSpace(game);

    const voidTile = promote();

    // First instance consumes the dirty flag.
    expect(pfA.findPath(from, to)).not.toBeNull();
    expect(game.isDeepSpaceGraphDirty()).toBe(false);

    // Second instance must still treat the HPA graph as stale even
    // though the flag is already cleared.
    const pathB = pfB.findPath(from, to);
    expect(pathB).not.toBeNull();
    expect(pathB!.includes(voidTile)).toBe(false);
    expect(hpaCalls).toBe(0);
  });

  it("the same instance stays on the simple fallback on later ticks", () => {
    const map = game.map();
    const from = map.ref(8, 1);
    const to = map.ref(15, 4);

    const pf = PathFinding.DeepSpace(game);
    const voidTile = promote();

    // First query consumes the dirty flag in the current tick.
    expect(pf.findPath(from, to)).not.toBeNull();
    expect(game.isDeepSpaceGraphDirty()).toBe(false);

    // Advance a tick — the per-tick latch of the old implementation
    // expired here and the wrapper reverted to the stale HPA graph.
    game.executeNextTick();

    pf.invalidate();
    const path = pf.findPath(from, to);
    expect(path).not.toBeNull();
    expect(path!.includes(voidTile)).toBe(false);
    expect(hpaCalls).toBe(0);
  });

  it("an instance created after the dirty flag was consumed routes via the simple fallback", () => {
    const map = game.map();
    const from = map.ref(8, 1);
    const to = map.ref(15, 4);

    const pfA = PathFinding.DeepSpace(game);
    const voidTile = promote();

    expect(pfA.findPath(from, to)).not.toBeNull();
    expect(game.isDeepSpaceGraphDirty()).toBe(false);

    // A unit launched after the promotion builds its switcher when the
    // flag is already clear; it must still observe the staleness.
    const pfC = PathFinding.DeepSpace(game);
    const pathC = pfC.findPath(from, to);
    expect(pathC).not.toBeNull();
    expect(pathC!.includes(voidTile)).toBe(false);
    expect(hpaCalls).toBe(0);
  });
});
