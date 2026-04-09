// @vitest-environment node
import { Group, Matrix4 } from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_RENDER_KEYS,
  createBaseTransform,
  INTERP_DURATION_MS,
  RenderKey,
  renderKeyFor,
  tileToWorld,
  UnitRendererEngine,
  UnitRendererGameView,
} from "../../../src/client/scene/UnitRenderer";
import { FrigateType, UnitType } from "../../../src/core/game/Game";
import type { UnitView } from "../../../src/core/game/GameView";

// ─── Deterministic mocks ────────────────────────────────────────────────────
//
// UnitRendererEngine only touches a narrow slice of UnitView/GameView, so the
// tests construct tiny fakes instead of standing up a real GameImpl. A test
// that depends on more than this surface is a signal the engine has grown a
// new external dependency — update the mock explicitly so it stays visible.

interface FakeUnitViewOptions {
  id: number;
  type: UnitType;
  tile: number;
  lastTile?: number;
  frigateType?: FrigateType;
  isLoaded?: boolean;
  territoryColor?: string;
}

function fakeUnit(opts: FakeUnitViewOptions): UnitView {
  const last = opts.lastTile ?? opts.tile;
  const color = opts.territoryColor ?? "#ff0000";
  // Cast through unknown — the engine only invokes the methods listed here.
  return {
    id: () => opts.id,
    type: () => opts.type,
    tile: () => opts.tile,
    lastTile: () => last,
    frigateType: () => opts.frigateType,
    isLoaded: () => opts.isLoaded,
    owner: () => ({
      territoryColor: () => ({
        toHex: () => color,
      }),
    }),
  } as unknown as UnitView;
}

function fakeGame(
  units: UnitView[],
  opts: {
    width?: number;
    height?: number;
    /**
     * Predicate that mirrors `GameView.isSector`. Defaults to treating
     * every tile as a sector — individual tests override this to simulate
     * deep-space traversal (e.g. for the AssaultShuttle bucket swap).
     */
    isSector?: (tile: number) => boolean;
  } = {},
): UnitRendererGameView {
  const width = opts.width ?? 100;
  const height = opts.height ?? 100;
  const isSector = opts.isSector ?? (() => true);
  return {
    width: () => width,
    height: () => height,
    // Pack (x, y) into a single tile ref: tile = y * width + x. This mirrors
    // GameMap.ref() closely enough for the engine's x()/y() lookups.
    x: (tile: number) => tile % width,
    y: (tile: number) => Math.floor(tile / width),
    units: () => units,
    isSector,
    nations: () => [],
  };
}

const tileOf = (x: number, y: number, width = 100) => y * width + x;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("renderKeyFor", () => {
  it("maps every ticketed mobile unit type to its own render key", () => {
    const cases: Array<[UnitType, UnitType]> = [
      [UnitType.AssaultShuttle, UnitType.AssaultShuttle],
      [UnitType.Battlecruiser, UnitType.Battlecruiser],
      [UnitType.TradeFreighter, UnitType.TradeFreighter],
      [UnitType.PlasmaBolt, UnitType.PlasmaBolt],
      [UnitType.PointDefenseMissile, UnitType.PointDefenseMissile],
      [UnitType.AntimatterTorpedo, UnitType.AntimatterTorpedo],
      [UnitType.NovaBomb, UnitType.NovaBomb],
      [UnitType.ClusterWarhead, UnitType.ClusterWarhead],
      [UnitType.ClusterWarheadSubmunition, UnitType.ClusterWarheadSubmunition],
    ];
    for (const [type, expected] of cases) {
      const u = fakeUnit({ id: 1, type, tile: 0 });
      expect(renderKeyFor(u)).toBe(expected);
    }
  });

  it("maps every ticketed structure type to its own render key", () => {
    const structures = [
      UnitType.Colony,
      UnitType.Spaceport,
      UnitType.Foundry,
      UnitType.OrbitalStrikePlatform,
      UnitType.DefenseStation,
      UnitType.PointDefenseArray,
    ];
    for (const type of structures) {
      const u = fakeUnit({ id: 1, type, tile: 0 });
      expect(renderKeyFor(u)).toBe(type);
    }
  });

  it("splits Train units into Engine/Carriage/LoadedCarriage subtypes", () => {
    const engine = fakeUnit({
      id: 1,
      type: UnitType.Frigate,
      tile: 0,
      frigateType: FrigateType.Engine,
    });
    const tailEngine = fakeUnit({
      id: 2,
      type: UnitType.Frigate,
      tile: 0,
      frigateType: FrigateType.TailEngine,
    });
    const emptyCar = fakeUnit({
      id: 3,
      type: UnitType.Frigate,
      tile: 0,
      frigateType: FrigateType.Carriage,
      isLoaded: false,
    });
    const loadedCar = fakeUnit({
      id: 4,
      type: UnitType.Frigate,
      tile: 0,
      frigateType: FrigateType.Carriage,
      isLoaded: true,
    });

    expect(renderKeyFor(engine)).toBe("FrigateEngine");
    expect(renderKeyFor(tailEngine)).toBe("FrigateEngine");
    expect(renderKeyFor(emptyCar)).toBe("FrigateCarriage");
    expect(renderKeyFor(loadedCar)).toBe("FrigateLoadedCarriage");
  });

  it("covers every render key declared in ALL_RENDER_KEYS", () => {
    // Sanity check: the render key enumeration should not grow without the
    // tests above also gaining coverage. This guards against silent drift
    // when new unit types are added to the ticket's shape table.
    const expected: RenderKey[] = [
      UnitType.AssaultShuttle,
      "DeepSpaceShuttle",
      UnitType.Battlecruiser,
      UnitType.TradeFreighter,
      "FrigateEngine",
      "FrigateCarriage",
      "FrigateLoadedCarriage",
      UnitType.PlasmaBolt,
      UnitType.PointDefenseMissile,
      UnitType.AntimatterTorpedo,
      UnitType.NovaBomb,
      UnitType.ClusterWarhead,
      UnitType.ClusterWarheadSubmunition,
      UnitType.Colony,
      UnitType.Spaceport,
      UnitType.Foundry,
      UnitType.OrbitalStrikePlatform,
      UnitType.DefenseStation,
      UnitType.PointDefenseArray,
    ];
    expect(new Set(ALL_RENDER_KEYS)).toEqual(new Set(expected));
    expect(ALL_RENDER_KEYS.length).toBe(expected.length);
  });

  it("keeps AssaultShuttles on sector tiles in the local-space bucket", () => {
    const shuttle = fakeUnit({
      id: 1,
      type: UnitType.AssaultShuttle,
      tile: 0,
    });
    // Default fakeGame reports every tile as a sector.
    expect(renderKeyFor(shuttle, fakeGame([shuttle]))).toBe(
      UnitType.AssaultShuttle,
    );
    // Calling without a game still returns the local-space key — preserved
    // for legacy callers / unit tests that don't care about the split.
    expect(renderKeyFor(shuttle)).toBe(UnitType.AssaultShuttle);
  });

  it("switches AssaultShuttles to DeepSpaceShuttle on non-sector tiles", () => {
    const shuttle = fakeUnit({
      id: 1,
      type: UnitType.AssaultShuttle,
      tile: 42,
    });
    const deepSpaceGame: UnitRendererGameView = {
      ...fakeGame([shuttle]),
      isSector: () => false,
    };
    expect(renderKeyFor(shuttle, deepSpaceGame)).toBe("DeepSpaceShuttle");
  });
});

describe("createBaseTransform", () => {
  it("stands cone-based mobile proxies upright along +Z", () => {
    // Cones default to tip along +Y. Rotating π/2 around X brings the tip
    // to +Z so transports/trade ships/SAM missiles read as upright in the
    // Z-up scene instead of lying across the map plane.
    for (const type of [
      UnitType.AssaultShuttle,
      UnitType.TradeFreighter,
      UnitType.PointDefenseMissile,
    ]) {
      const t = createBaseTransform(type);
      expect(t.rotation).toEqual([Math.PI / 2, 0, 0]);
    }
  });

  it("stands the Colony hemisphere and OrbitalStrikePlatform disk upright along +Z", () => {
    // The dome primitive and the flat silo disk share the same Y→Z fix.
    expect(createBaseTransform(UnitType.Colony).rotation).toEqual([
      Math.PI / 2,
      0,
      0,
    ]);
    expect(
      createBaseTransform(UnitType.OrbitalStrikePlatform).rotation,
    ).toEqual([Math.PI / 2, 0, 0]);
  });

  it("inverts the PointDefenseArray cone so its tip points into the map plane", () => {
    // -π/2 around X maps +Y → -Z, giving the funnel/launcher look with the
    // wide base on top.
    expect(createBaseTransform(UnitType.PointDefenseArray).rotation).toEqual([
      -Math.PI / 2,
      0,
      0,
    ]);
  });

  it("leaves the Port torus flat (no rotation) with structure scaling", () => {
    // TorusGeometry sweeps around +Z by default, so in a Z-up world it is
    // already flat on the map. Any non-identity rotation would tip it onto
    // its side — guard against regressions.
    const t = createBaseTransform(UnitType.Spaceport);
    expect(t.rotation).toEqual([0, 0, 0]);
    expect(t.scale).toEqual([2, 2, 2]); // structure scale multiplier
    expect(t.offset).toEqual([0, 0, 0]);
  });

  it("returns identity transforms for proxies without an axial orientation", () => {
    for (const type of [
      UnitType.Battlecruiser,
      UnitType.Foundry,
      UnitType.DefenseStation,
      UnitType.PlasmaBolt,
      UnitType.AntimatterTorpedo,
      UnitType.NovaBomb,
      UnitType.ClusterWarhead,
      UnitType.ClusterWarheadSubmunition,
    ]) {
      expect(createBaseTransform(type).rotation).toEqual([0, 0, 0]);
    }
  });
});

describe("UnitRendererEngine instance-count lifecycle", () => {
  let group: Group;
  let engine: UnitRendererEngine;

  beforeEach(() => {
    group = new Group();
    // Small initial capacity to exercise both the common path and the growth
    // path without allocating a 512-slot buffer per test.
    engine = new UnitRendererEngine(group, {
      initialCapacity: 4,
      skipGltfLoading: true,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("initialises every render key's pool with count=0", () => {
    for (const key of ALL_RENDER_KEYS) {
      const pool = engine.pools.get(key);
      expect(pool).toBeDefined();
      expect(pool!.mesh.count).toBe(0);
    }
  });

  it("writes one instance per spawned unit and zeroes empty pools", () => {
    const units: UnitView[] = [
      fakeUnit({ id: 1, type: UnitType.Battlecruiser, tile: tileOf(10, 10) }),
      fakeUnit({ id: 2, type: UnitType.Battlecruiser, tile: tileOf(20, 20) }),
      fakeUnit({ id: 3, type: UnitType.Colony, tile: tileOf(30, 30) }),
    ];
    engine.update(fakeGame(units), 1000);

    expect(engine.pools.get(UnitType.Battlecruiser)!.mesh.count).toBe(2);
    expect(engine.pools.get(UnitType.Colony)!.mesh.count).toBe(1);
    // Every other pool should report zero instances — a regression that
    // leaves stale counts would show up here.
    for (const key of ALL_RENDER_KEYS) {
      if (key === UnitType.Battlecruiser || key === UnitType.Colony) continue;
      expect(engine.pools.get(key)!.mesh.count).toBe(0);
    }
  });

  it("decrements mesh.count when units despawn between frames", () => {
    const t = tileOf(5, 5);
    const warship1 = fakeUnit({ id: 1, type: UnitType.Battlecruiser, tile: t });
    const warship2 = fakeUnit({ id: 2, type: UnitType.Battlecruiser, tile: t });
    engine.update(fakeGame([warship1, warship2]), 1000);
    expect(engine.pools.get(UnitType.Battlecruiser)!.mesh.count).toBe(2);

    // Despawn warship2
    engine.update(fakeGame([warship1]), 1000);
    expect(engine.pools.get(UnitType.Battlecruiser)!.mesh.count).toBe(1);

    // Despawn the rest
    engine.update(fakeGame([]), 1000);
    expect(engine.pools.get(UnitType.Battlecruiser)!.mesh.count).toBe(0);
  });

  it("grows the pool past its initial capacity instead of dropping units", () => {
    // Start with 4-slot pool, push 6 warships → engine should double capacity.
    const many: UnitView[] = Array.from({ length: 6 }, (_, i) =>
      fakeUnit({ id: i + 1, type: UnitType.Battlecruiser, tile: tileOf(i, 0) }),
    );
    engine.update(fakeGame(many), 1000);

    const pool = engine.pools.get(UnitType.Battlecruiser)!;
    expect(pool.capacity).toBeGreaterThanOrEqual(6);
    expect(pool.mesh.count).toBe(6);
  });

  it("cleans up interpolation state for despawned units", () => {
    const t0 = tileOf(5, 5);
    const t1 = tileOf(6, 5);
    const ship = fakeUnit({
      id: 42,
      type: UnitType.AssaultShuttle,
      tile: t0,
    });
    engine.update(fakeGame([ship]), 0);
    // Move the ship so the engine opens an interp entry.
    const moved = fakeUnit({
      id: 42,
      type: UnitType.AssaultShuttle,
      tile: t1,
      lastTile: t0,
    });
    engine.update(fakeGame([moved]), 10);
    expect(engine.interpMap.has(42)).toBe(true);
    expect(engine.lastKnownTile.has(42)).toBe(true);

    // Despawn: the interp map should be drained on the next update.
    engine.update(fakeGame([]), 20);
    expect(engine.interpMap.has(42)).toBe(false);
    expect(engine.lastKnownTile.has(42)).toBe(false);
  });
});

describe("UnitRendererEngine mobile-unit interpolation", () => {
  let group: Group;
  let engine: UnitRendererEngine;

  beforeEach(() => {
    group = new Group();
    engine = new UnitRendererEngine(group, {
      initialCapacity: 4,
      skipGltfLoading: true,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("interpolates smoothly from lastTile() to tile() across frames", () => {
    const width = 100;
    const halfW = width / 2;
    const halfH = width / 2;
    const prevTile = tileOf(10, 10, width);
    const curTile = tileOf(20, 10, width);

    // Frame 1: seed lastKnownTile for the ship at prevTile (no movement yet).
    const seed = fakeUnit({
      id: 7,
      type: UnitType.AssaultShuttle,
      tile: prevTile,
    });
    engine.update(fakeGame([seed], { width, height: width }), 0);
    expect(engine.interpMap.has(7)).toBe(false);
    expect(engine.lastKnownTile.get(7)).toBe(prevTile);

    // Frame 2: ship moved to curTile → interp opens with start=1000.
    const moved = fakeUnit({
      id: 7,
      type: UnitType.AssaultShuttle,
      tile: curTile,
      lastTile: prevTile,
    });
    engine.update(fakeGame([moved], { width, height: width }), 1000);
    const state = engine.interpMap.get(7);
    expect(state).toBeDefined();
    expect(state!.startTime).toBe(1000);
    expect(state!.duration).toBe(INTERP_DURATION_MS);

    // Expected world-space endpoints (tile centre = tile coord + 0.5,
    // and the engine flips Y so north is up).
    const fromX = 10 + 0.5 - halfW;
    const fromY = -(10 + 0.5 - halfH);
    const toX = 20 + 0.5 - halfW;
    const toY = -(10 + 0.5 - halfH);
    expect(state!.fromX).toBeCloseTo(fromX);
    expect(state!.fromY).toBeCloseTo(fromY);
    expect(state!.toX).toBeCloseTo(toX);
    expect(state!.toY).toBeCloseTo(toY);

    // Mid-interp tick (50% through the 150ms window). With smooth-step
    // easing, t=0.5 → s=0.5, so the unit should sit exactly halfway between
    // the endpoints. The interp entry should still be live.
    engine.update(
      fakeGame([moved], { width, height: width }),
      1000 + INTERP_DURATION_MS / 2,
    );
    expect(engine.interpMap.has(7)).toBe(true);

    // Final tick: once elapsed ≥ duration, the engine snaps to the target
    // and drops the interp entry. Feeding another update should leave the
    // map clean without reopening it (the unit hasn't moved since).
    engine.update(
      fakeGame([moved], { width, height: width }),
      1000 + INTERP_DURATION_MS + 1,
    );
    expect(engine.interpMap.has(7)).toBe(false);
    expect(engine.lastKnownTile.get(7)).toBe(curTile);
  });

  it("does not interpolate structures — they jump straight to tile()", () => {
    // Structures bypass the interp state entirely. Moving a silo (which
    // normally wouldn't happen, but we simulate it for test coverage)
    // should never push an entry into interpMap.
    const a = fakeUnit({
      id: 99,
      type: UnitType.OrbitalStrikePlatform,
      tile: tileOf(10, 10),
    });
    engine.update(fakeGame([a]), 0);
    const b = fakeUnit({
      id: 99,
      type: UnitType.OrbitalStrikePlatform,
      tile: tileOf(11, 10),
      lastTile: tileOf(10, 10),
    });
    engine.update(fakeGame([b]), 10);
    expect(engine.interpMap.has(99)).toBe(false);
  });
});

describe("tile-to-world centering", () => {
  let group: Group;
  let engine: UnitRendererEngine;

  beforeEach(() => {
    group = new Group();
    engine = new UnitRendererEngine(group, {
      initialCapacity: 4,
      skipGltfLoading: true,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("tileToWorld adds the half-tile centre offset", () => {
    const { wx, wy } = tileToWorld(10, 20, 50, 50);
    expect(wx).toBeCloseTo(10 + 0.5 - 50);
    expect(wy).toBeCloseTo(-(20 + 0.5 - 50));
  });

  it("places a structure instance at the tile centre, not the tile corner", () => {
    const width = 100;
    const height = 100;
    const halfW = width / 2;
    const halfH = height / 2;
    const tileX = 10;
    const tileY = 20;
    const tile = tileOf(tileX, tileY, width);

    const city = fakeUnit({ id: 1, type: UnitType.Colony, tile });
    engine.update(fakeGame([city], { width, height }), 0);

    const mesh = engine.pools.get(UnitType.Colony)!.mesh;
    const mat = new Matrix4();
    mesh.getMatrixAt(0, mat);
    // Matrix4 column-major: elements[12]=tx, elements[13]=ty
    const worldX = mat.elements[12];
    const worldY = mat.elements[13];

    expect(worldX).toBeCloseTo(tileX + 0.5 - halfW);
    expect(worldY).toBeCloseTo(-(tileY + 0.5 - halfH));
  });
});

describe("structure grounding", () => {
  it("each structure key produces a matrix whose base sits on the map plane (z>=0)", () => {
    const width = 100;
    const height = 100;
    const tile = tileOf(50, 50, width);

    const structureKeys: UnitType[] = [
      UnitType.Colony,
      UnitType.Spaceport,
      UnitType.Foundry,
      UnitType.OrbitalStrikePlatform,
      UnitType.DefenseStation,
      UnitType.PointDefenseArray,
    ];

    for (const key of structureKeys) {
      const g = new Group();
      const eng = new UnitRendererEngine(g, {
        initialCapacity: 4,
        skipGltfLoading: true,
      });

      const unit = fakeUnit({ id: 1, type: key, tile });
      eng.update(fakeGame([unit], { width, height }), 0);

      const mesh = eng.pools.get(key)!.mesh;
      const mat = new Matrix4();
      mesh.getMatrixAt(0, mat);

      // The instance Z position (element 14) should equal the structure
      // elevation height plus the grounding offset stored in baseTransform.
      const entry = eng.registry.get(key)!;
      const groundingZ = entry.baseTransform.offset[2];
      expect(groundingZ).toBeGreaterThanOrEqual(0);
      // Structures are now elevated above the plane for visibility from angles
      expect(mat.elements[14]).toBeGreaterThan(0);

      eng.dispose();
    }
  });

  it("does not use a single shared height for all structures", () => {
    const group = new Group();
    const engine = new UnitRendererEngine(group, {
      initialCapacity: 4,
      skipGltfLoading: true,
    });

    // Collect all structure grounding offsets — they should not all be equal
    const offsets = new Set<number>();
    const structureKeys: UnitType[] = [
      UnitType.Colony,
      UnitType.Spaceport,
      UnitType.Foundry,
      UnitType.OrbitalStrikePlatform,
      UnitType.DefenseStation,
      UnitType.PointDefenseArray,
    ];
    for (const key of structureKeys) {
      const entry = engine.registry.get(key)!;
      offsets.add(Math.round(entry.baseTransform.offset[2] * 1000) / 1000);
    }
    expect(offsets.size).toBeGreaterThan(1);

    engine.dispose();
  });
});

describe("mobile-unit facing / heading", () => {
  let group: Group;
  let engine: UnitRendererEngine;

  beforeEach(() => {
    group = new Group();
    engine = new UnitRendererEngine(group, {
      initialCapacity: 4,
      skipGltfLoading: true,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("records a world-space heading when a ship moves between two tiles", () => {
    // Ship moves from (10,10) → (20,10) which is +X in tile coords.
    // tileToWorld flips the Y axis, so a +X tile delta stays +X in world
    // space. Expected heading is atan2(0, +dx) = 0.
    const prev = tileOf(10, 10);
    const cur = tileOf(20, 10);

    engine.update(
      fakeGame([
        fakeUnit({ id: 1, type: UnitType.AssaultShuttle, tile: prev }),
      ]),
      0,
    );
    // On the first frame the ship has no lastKnownTile yet, so no heading.
    expect(engine.headings.has(1)).toBe(false);

    engine.update(
      fakeGame([
        fakeUnit({
          id: 1,
          type: UnitType.AssaultShuttle,
          tile: cur,
          lastTile: prev,
        }),
      ]),
      10,
    );
    const eastHeading = engine.headings.get(1);
    expect(eastHeading).toBeDefined();
    expect(eastHeading!).toBeCloseTo(0);
  });

  it("records a northward heading for a -tileY (tile grid 'up') move", () => {
    // tileToWorld flips Y: -tileY maps to +worldY. A move from (10,20) →
    // (10,10) is "up" on the tile grid, which is +Y in world coords, so
    // atan2(+1, 0) = +π/2.
    const prev = tileOf(10, 20);
    const cur = tileOf(10, 10);

    engine.update(
      fakeGame([
        fakeUnit({ id: 2, type: UnitType.TradeFreighter, tile: prev }),
      ]),
      0,
    );
    engine.update(
      fakeGame([
        fakeUnit({
          id: 2,
          type: UnitType.TradeFreighter,
          tile: cur,
          lastTile: prev,
        }),
      ]),
      10,
    );
    const heading = engine.headings.get(2);
    expect(heading).toBeDefined();
    expect(heading!).toBeCloseTo(Math.PI / 2);
  });

  it("keeps the last heading across frames when the ship is not moving", () => {
    // Move once, then re-submit the same tile on the next frame — heading
    // should persist so at-rest ships don't snap back to yaw=0.
    const prev = tileOf(5, 5);
    const cur = tileOf(15, 5);

    engine.update(
      fakeGame([fakeUnit({ id: 3, type: UnitType.Battlecruiser, tile: prev })]),
      0,
    );
    engine.update(
      fakeGame([
        fakeUnit({
          id: 3,
          type: UnitType.Battlecruiser,
          tile: cur,
          lastTile: prev,
        }),
      ]),
      10,
    );
    const recorded = engine.headings.get(3);
    expect(recorded).toBeDefined();

    // Ship stays at cur for many subsequent frames (no new movement).
    for (let t = 20; t < 500; t += 10) {
      engine.update(
        fakeGame([
          fakeUnit({
            id: 3,
            type: UnitType.Battlecruiser,
            tile: cur,
            lastTile: cur,
          }),
        ]),
        t,
      );
    }
    expect(engine.headings.get(3)).toBeCloseTo(recorded!);
  });

  it("clears heading state when a unit despawns", () => {
    const prev = tileOf(5, 5);
    const cur = tileOf(6, 5);
    engine.update(
      fakeGame([
        fakeUnit({ id: 4, type: UnitType.AssaultShuttle, tile: prev }),
      ]),
      0,
    );
    engine.update(
      fakeGame([
        fakeUnit({
          id: 4,
          type: UnitType.AssaultShuttle,
          tile: cur,
          lastTile: prev,
        }),
      ]),
      10,
    );
    expect(engine.headings.has(4)).toBe(true);

    // Despawn.
    engine.update(fakeGame([]), 20);
    expect(engine.headings.has(4)).toBe(false);
  });
});

describe("AssaultShuttle local-space ↔ deep-space bucket swap", () => {
  let group: Group;
  let engine: UnitRendererEngine;

  beforeEach(() => {
    group = new Group();
    engine = new UnitRendererEngine(group, {
      initialCapacity: 4,
      skipGltfLoading: true,
    });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("buckets a shuttle on a sector tile into AssaultShuttle", () => {
    const shuttle = fakeUnit({
      id: 11,
      type: UnitType.AssaultShuttle,
      tile: tileOf(10, 10),
    });
    engine.update(fakeGame([shuttle]), 0);
    expect(engine.pools.get(UnitType.AssaultShuttle)!.mesh.count).toBe(1);
    expect(engine.pools.get("DeepSpaceShuttle")!.mesh.count).toBe(0);
  });

  it("buckets a shuttle on a non-sector tile into DeepSpaceShuttle", () => {
    const shuttle = fakeUnit({
      id: 12,
      type: UnitType.AssaultShuttle,
      tile: tileOf(50, 50),
    });
    engine.update(fakeGame([shuttle], { isSector: () => false }), 0);
    expect(engine.pools.get(UnitType.AssaultShuttle)!.mesh.count).toBe(0);
    expect(engine.pools.get("DeepSpaceShuttle")!.mesh.count).toBe(1);
  });

  it("moves a shuttle between buckets as it crosses into deep space", () => {
    // Frame 1 — on a sector tile → local-space bucket.
    const onSector = fakeUnit({
      id: 13,
      type: UnitType.AssaultShuttle,
      tile: tileOf(10, 10),
    });
    engine.update(fakeGame([onSector], { isSector: () => true }), 0);
    expect(engine.pools.get(UnitType.AssaultShuttle)!.mesh.count).toBe(1);
    expect(engine.pools.get("DeepSpaceShuttle")!.mesh.count).toBe(0);

    // Frame 2 — same unit id, now on a non-sector tile → deep-space bucket.
    // Interpolation / heading state should carry across because they are
    // keyed by unit id, not render key.
    const inSpace = fakeUnit({
      id: 13,
      type: UnitType.AssaultShuttle,
      tile: tileOf(11, 10),
      lastTile: tileOf(10, 10),
    });
    engine.update(fakeGame([inSpace], { isSector: () => false }), 10);
    expect(engine.pools.get(UnitType.AssaultShuttle)!.mesh.count).toBe(0);
    expect(engine.pools.get("DeepSpaceShuttle")!.mesh.count).toBe(1);
    expect(engine.lastKnownTile.get(13)).toBe(tileOf(11, 10));
    expect(engine.headings.has(13)).toBe(true);
  });
});
