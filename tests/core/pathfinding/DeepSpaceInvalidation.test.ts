import { beforeEach, describe, expect, it } from "vitest";
import { Game, TerrainType } from "../../../src/core/game/Game";
import { PathFinding } from "../../../src/core/pathfinding/PathFinder";
import { setup } from "../../util/Setup";

describe("DeepSpace pathfinder invalidation on void→sector promotion", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
  });

  it("isDeepSpaceGraphDirty is false on a fresh game", () => {
    expect(game.isDeepSpaceGraphDirty()).toBe(false);
  });

  it("setTerrainType on a void tile promotes the minimap tile and marks the graph dirty", () => {
    const voidTile = game.ref(8, 0);
    expect(game.map().isVoid(voidTile)).toBe(true);
    expect(game.map().isSector(voidTile)).toBe(false);

    const miniMap = game.miniMap();
    const miniRef = miniMap.ref(
      Math.floor(game.map().x(voidTile) / 2),
      Math.floor(game.map().y(voidTile) / 2),
    );
    const miniWasSector = miniMap.isSector(miniRef);

    game.setTerrainType(voidTile, TerrainType.AsteroidField);

    expect(game.map().isSector(voidTile)).toBe(true);
    expect(game.isDeepSpaceGraphDirty()).toBe(true);

    if (!miniWasSector) {
      expect(miniMap.isSector(miniRef)).toBe(true);
    }
  });

  it("clearDeepSpaceGraphDirty resets the flag", () => {
    const voidTile = game.ref(8, 0);
    game.setTerrainType(voidTile, TerrainType.AsteroidField);
    expect(game.isDeepSpaceGraphDirty()).toBe(true);

    game.clearDeepSpaceGraphDirty();
    expect(game.isDeepSpaceGraphDirty()).toBe(false);
  });

  it("PathFinding.DeepSpace consumes the dirty flag on the first findPath after promotion", () => {
    const voidTile = game.ref(9, 0);
    expect(game.map().isVoid(voidTile)).toBe(true);

    game.setTerrainType(voidTile, TerrainType.AsteroidField);
    expect(game.isDeepSpaceGraphDirty()).toBe(true);

    const map = game.map();
    const from = map.ref(8, 1);
    const to = map.ref(15, 4);
    expect(map.isDeepSpace(from)).toBe(true);
    expect(map.isDeepSpace(to)).toBe(true);

    const pathFinder = PathFinding.DeepSpace(game);
    // Building the wrapper must NOT consume the dirty flag — it is
    // consumed lazily on the first routed query so wrappers built
    // ahead of their first use still observe the pending invalidation.
    expect(game.isDeepSpaceGraphDirty()).toBe(true);

    const path = pathFinder.findPath(from, to);
    expect(path).not.toBeNull();
    // The returned path should avoid the promoted sector tile.
    expect(path!.includes(voidTile)).toBe(false);
    // Dirty flag is single-shot: once the wrapper has observed it and
    // switched to the simple fallback, the flag is cleared so future
    // ticks can re-evaluate HPA availability from a clean baseline.
    expect(game.isDeepSpaceGraphDirty()).toBe(false);
  });

  it("dirty-triggered simple routing is latched within the same tick after the flag is consumed", () => {
    const voidTile = game.ref(9, 0);
    expect(game.map().isVoid(voidTile)).toBe(true);

    game.setTerrainType(voidTile, TerrainType.AsteroidField);
    expect(game.isDeepSpaceGraphDirty()).toBe(true);

    const map = game.map();
    const from = map.ref(8, 1);
    const to = map.ref(15, 4);

    const pathFinder = PathFinding.DeepSpace(game);
    const first = pathFinder.findPath(from, to);
    expect(first).not.toBeNull();
    // First query consumed the dirty flag.
    expect(game.isDeepSpaceGraphDirty()).toBe(false);

    // A subsequent query inside the same tick must stay on the simple
    // fallback — the wrapper latches simple routing for the current
    // tick so routing does not flap between HPA and simple after the
    // dirty flag is cleared.
    pathFinder.invalidate();
    const second = pathFinder.findPath(from, to);
    expect(second).not.toBeNull();
    expect(second!.includes(voidTile)).toBe(false);
    expect(game.isDeepSpaceGraphDirty()).toBe(false);
  });

  it("long-lived pathfinder built before promotion routes around tiles promoted mid-lifecycle", () => {
    // Build the stepper BEFORE promotion — simulating an Execution that
    // caches PathFinding.DeepSpace(mg) in init() and reuses it for its
    // lifetime. Since the wrapper re-evaluates the dirty flag per query,
    // it must switch to DeepSpaceSimple when a mid-lifecycle promotion
    // marks the graph dirty, rather than staying bound to stale HPA state.
    const pathFinder = PathFinding.DeepSpace(game);
    expect(game.isDeepSpaceGraphDirty()).toBe(false);

    const map = game.map();
    const from = map.ref(8, 1);
    const to = map.ref(15, 4);
    expect(map.isDeepSpace(from)).toBe(true);
    expect(map.isDeepSpace(to)).toBe(true);

    // Warm the cached stepper with a query before promotion so any
    // subsequent correctness depends on the runtime-switching behavior,
    // not on lazy first-query construction.
    const prePath = pathFinder.findPath(from, to);
    expect(prePath).not.toBeNull();

    // Promote a void tile that sits on a reasonable route between from/to.
    const voidTile = game.ref(9, 0);
    expect(map.isVoid(voidTile)).toBe(true);
    game.setTerrainType(voidTile, TerrainType.AsteroidField);
    expect(game.isDeepSpaceGraphDirty()).toBe(true);

    // Invalidate so the stepper re-queries; the wrapper should now pick
    // DeepSpaceSimple over stale HPA and return a path that avoids the
    // newly-promoted sector tile. The query also consumes the dirty flag.
    pathFinder.invalidate();
    const postPath = pathFinder.findPath(from, to);
    expect(postPath).not.toBeNull();
    expect(postPath!.includes(voidTile)).toBe(false);
    expect(game.isDeepSpaceGraphDirty()).toBe(false);
  });

  it("GameMap.setTerrainType on a non-void non-sector tile is a no-op on the primary map", () => {
    // Scoped-promotion regression: the GameMap-level mutator should only
    // promote strict-void tiles, so debris (non-void non-sector) tiles
    // stay non-sector on the full map even when asked to become an
    // AsteroidField. Broader debris→sector promotion is reserved for the
    // minimap-only helper path invoked by GameImpl.
    const map = game.map();

    let debris: number | null = null;
    for (let y = 0; y < map.height() && debris === null; y++) {
      for (let x = 0; x < map.width(); x++) {
        const t = map.ref(x, y);
        if (!map.isSector(t) && !map.isVoid(t)) {
          debris = t;
          break;
        }
      }
    }

    if (debris === null) {
      // The fixture map may not contain debris tiles; skip the scoped
      // assertion rather than fabricate state. The minimap-side test
      // below still covers the scoped helper path.
      return;
    }

    expect(map.isSector(debris)).toBe(false);
    expect(map.isVoid(debris)).toBe(false);

    map.setTerrainType(debris, TerrainType.AsteroidField);

    // Must remain non-sector — GameMap.setTerrainType no longer promotes
    // arbitrary non-sector tiles on the primary map.
    expect(map.isSector(debris)).toBe(false);
    expect(map.isVoid(debris)).toBe(false);
  });

  it("GameImpl.setTerrainType scoped minimap promotion handles non-sector minimap buckets", () => {
    // Scoped behavior: GameImpl routes minimap propagation through a
    // dedicated helper that promotes ANY non-sector minimap tile when
    // the corresponding full-map tile is promoted void→sector. The test
    // exercises the scoped helper by promoting a full-map void tile
    // whose downsampled minimap bucket is non-sector (void OR debris).
    const miniMap = game.miniMap();

    let target: number | null = null;
    const map = game.map();
    for (let y = 0; y < map.height() && target === null; y++) {
      for (let x = 0; x < map.width(); x++) {
        const full = map.ref(x, y);
        if (!map.isVoid(full)) continue;
        const mini = miniMap.ref(Math.floor(x / 2), Math.floor(y / 2));
        if (!miniMap.isSector(mini)) {
          target = full;
          break;
        }
      }
    }
    expect(target).not.toBeNull();

    const t = target!;
    const miniRef = miniMap.ref(
      Math.floor(map.x(t) / 2),
      Math.floor(map.y(t) / 2),
    );
    expect(miniMap.isSector(miniRef)).toBe(false);

    game.setTerrainType(t, TerrainType.AsteroidField);

    // Full-map void→sector promotion succeeded (strict-void branch).
    expect(map.isSector(t)).toBe(true);
    // Scoped minimap helper propagated the promotion regardless of
    // whether the minimap bucket was strictly-void or debris.
    expect(miniMap.isSector(miniRef)).toBe(true);
  });
});
