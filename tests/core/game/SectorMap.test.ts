// @vitest-environment node
import { Player, TerrainType } from "../../../src/core/game/Game";
import { GameMapImpl, TileRef } from "../../../src/core/game/GameMap";
import {
  HABITABILITY_ASTEROID,
  HABITABILITY_NEBULA,
  HABITABILITY_OPEN_SPACE,
  habitabilityForTerrain,
  SectorMap,
} from "../../../src/core/game/SectorMap";

/**
 * Unit tests for the SectorMap BFS infrastructure introduced by Ticket 2
 * (SectorMap Infrastructure + Habitability Mapping). These tests do NOT
 * exercise the economy formulas — those still produce identical values and
 * are covered by the characterization tests in
 * `tests/economy/EconomyFormulas.test.ts`.
 *
 * The tests construct synthetic GameMapImpl instances directly so we can
 * pin the terrain layout precisely and assert against known sector
 * partitions.
 */

// Terrain bit layout — mirrors GameMapImpl's private constants.
const LAND_BIT = 1 << 7; // IS_LAND_BIT — marks a tile as a sector tile.
const VOID_BIT = 1 << 5; // VOID_BIT     — marks a tile as deep space.

/**
 * Returns a terrain byte for a sector tile with the given magnitude.
 * Magnitude buckets follow GameMapImpl.terrainType():
 *   <10  → OpenSpace
 *   <20  → Nebula
 *   ≥20  → AsteroidField (capped at 31 by the 5-bit MAGNITUDE_MASK)
 */
function sectorTile(magnitude: number): number {
  return LAND_BIT | (magnitude & 0x1f);
}

/** Open-space sector tile (habitability 1.0). */
const OPEN = sectorTile(5);
/** Nebula sector tile (habitability 0.6). */
const NEBULA = sectorTile(15);
/** Asteroid field sector tile (habitability 0.3). */
const ASTEROID = sectorTile(25);
/** Deep space (non-sector void). */
const VOID = VOID_BIT;
/** Debris field (non-sector, not void). */
const DEBRIS = 0;

/**
 * Builds a `GameMapImpl` from a flat row-major terrain byte array. The
 * `num_land_tiles` field is computed by counting tiles with the LAND_BIT
 * set, matching how `genTerrainFromBin` populates real maps.
 */
function buildMap(
  width: number,
  height: number,
  terrain: number[],
): GameMapImpl {
  if (terrain.length !== width * height) {
    throw new Error(
      `terrain length ${terrain.length} does not match ${width}x${height}`,
    );
  }
  const data = new Uint8Array(terrain);
  let numLand = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] & LAND_BIT) numLand++;
  }
  return new GameMapImpl(width, height, data, numLand);
}

/**
 * Monotonic counter for assigning distinct smallIDs to fake players across
 * tests. SectorMap keys its per-player running totals on `smallID`, so
 * tests that build multiple players need distinct IDs to avoid the totals
 * bleeding together.
 */
let _nextFakePlayerSmallID = 1;

/**
 * Minimal Player stand-in carrying just the slice of the interface that
 * SectorMap actually consumes (`tiles()` + `smallID()`). Also seeds the
 * SectorMap's incremental per-player running totals via
 * {@link SectorMap.recordTileGained} so tests bypass the GameImpl
 * conquer/relinquish path that would normally drive those updates.
 *
 * Cast to `Player` at the call site so we don't have to mock the dozens
 * of unrelated methods.
 */
function fakePlayerWithTiles(sm: SectorMap, tiles: Iterable<TileRef>): Player {
  const set = new Set<TileRef>(tiles);
  const smallID = _nextFakePlayerSmallID++;
  for (const tile of set) {
    sm.recordTileGained(smallID, tile);
  }
  return {
    tiles: () => set as ReadonlySet<TileRef>,
    smallID: () => smallID,
  } as unknown as Player;
}

describe("habitabilityForTerrain", () => {
  test("maps each TerrainType to the documented constant", () => {
    expect(habitabilityForTerrain(TerrainType.OpenSpace)).toBe(
      HABITABILITY_OPEN_SPACE,
    );
    expect(habitabilityForTerrain(TerrainType.Nebula)).toBe(
      HABITABILITY_NEBULA,
    );
    expect(habitabilityForTerrain(TerrainType.AsteroidField)).toBe(
      HABITABILITY_ASTEROID,
    );
  });

  test("returns 0 for non-sector terrain (DebrisField, DeepSpace)", () => {
    expect(habitabilityForTerrain(TerrainType.DebrisField)).toBe(0);
    expect(habitabilityForTerrain(TerrainType.DeepSpace)).toBe(0);
  });

  test("constants match the GDD Approach §3 mapping", () => {
    expect(HABITABILITY_OPEN_SPACE).toBe(1.0);
    expect(HABITABILITY_NEBULA).toBe(0.6);
    expect(HABITABILITY_ASTEROID).toBe(0.3);
  });
});

describe("SectorMap construction", () => {
  test("empty seeds → all sector IDs are 0", () => {
    // 3x3 entirely-sector map with no nation seeds. The "test maps with
    // empty nations[]" edge case from Approach §3 — every tile should
    // resolve to sector 0 so the (forthcoming) habitability cap and
    // volume bonus collapse to zero.
    const map = buildMap(3, 3, [
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
    ]);
    const sm = new SectorMap(map, []);

    expect(sm.numSectors()).toBe(0);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(sm.sectorOf(map.ref(x, y))).toBe(0);
      }
    }
    expect(sm.sectorTileCount(0)).toBe(0);
    expect(sm.sectorTileCount(1)).toBe(0);
  });

  test("single seed in a fully-connected sector floods every sector tile", () => {
    // 3x3 of pure sector tiles → BFS from any seed should paint all 9.
    const map = buildMap(3, 3, [
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
    ]);
    const sm = new SectorMap(map, [{ x: 1, y: 1 }]);

    expect(sm.numSectors()).toBe(1);
    expect(sm.sectorTileCount(1)).toBe(9);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(sm.sectorOf(map.ref(x, y))).toBe(1);
      }
    }
  });

  test("two disjoint sectors get distinct sector IDs", () => {
    // 5x3 with a vertical strip of deep space splitting two 2x3 sectors.
    //   S S V S S
    //   S S V S S
    //   S S V S S
    const map = buildMap(5, 3, [
      OPEN,
      OPEN,
      VOID,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      VOID,
      OPEN,
      OPEN,
      OPEN,
      OPEN,
      VOID,
      OPEN,
      OPEN,
    ]);
    const sm = new SectorMap(map, [
      { x: 0, y: 0 }, // first seed → sector 1 (left half)
      { x: 4, y: 0 }, // second seed → sector 2 (right half)
    ]);

    expect(sm.numSectors()).toBe(2);
    expect(sm.sectorTileCount(1)).toBe(6);
    expect(sm.sectorTileCount(2)).toBe(6);

    // Left half painted with sector 1
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 2; x++) {
        expect(sm.sectorOf(map.ref(x, y))).toBe(1);
      }
    }
    // Right half painted with sector 2
    for (let y = 0; y < 3; y++) {
      for (let x = 3; x < 5; x++) {
        expect(sm.sectorOf(map.ref(x, y))).toBe(2);
      }
    }
    // Void column stays at sector 0
    for (let y = 0; y < 3; y++) {
      expect(sm.sectorOf(map.ref(2, y))).toBe(0);
    }
  });

  test("a second seed inside an already-flooded component is skipped", () => {
    // Single connected sector with two seeds — only the first should
    // create a new sector ID; the second is already painted.
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);

    expect(sm.numSectors()).toBe(1);
    expect(sm.sectorTileCount(1)).toBe(3);
    expect(sm.sectorOf(map.ref(0, 0))).toBe(1);
    expect(sm.sectorOf(map.ref(1, 0))).toBe(1);
    expect(sm.sectorOf(map.ref(2, 0))).toBe(1);
  });

  test("seed on a non-sector tile is ignored", () => {
    // Single seed sitting on a deep-space tile — no flood happens.
    const map = buildMap(3, 1, [OPEN, VOID, OPEN]);
    const sm = new SectorMap(map, [{ x: 1, y: 0 }]);

    expect(sm.numSectors()).toBe(0);
    expect(sm.sectorOf(map.ref(0, 0))).toBe(0);
    expect(sm.sectorOf(map.ref(1, 0))).toBe(0);
    expect(sm.sectorOf(map.ref(2, 0))).toBe(0);
  });

  test("undefined / null seeds are skipped without throwing", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [undefined, null, { x: 0, y: 0 }]);

    expect(sm.numSectors()).toBe(1);
    expect(sm.sectorTileCount(1)).toBe(3);
  });

  test("out-of-bounds seed coordinates are silently dropped", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [
      { x: -1, y: 0 },
      { x: 0, y: 5 },
      { x: 1, y: 0 },
    ]);

    expect(sm.numSectors()).toBe(1);
    expect(sm.sectorTileCount(1)).toBe(3);
  });

  test("sectorTileCount returns 0 for unknown sector IDs", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    expect(sm.sectorTileCount(0)).toBe(0);
    expect(sm.sectorTileCount(2)).toBe(0);
    expect(sm.sectorTileCount(99)).toBe(0);
  });
});

describe("SectorMap player queries", () => {
  test("playerOwnedSectorTiles counts only tiles assigned to a sector", () => {
    // 5x1: sector | sector | void | sector | sector
    // Two seeds → all four sector tiles painted (split into 2 sectors).
    // The void tile in the middle stays at sector 0.
    const map = buildMap(5, 1, [OPEN, OPEN, VOID, OPEN, OPEN]);
    const sm = new SectorMap(map, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);

    // Player owns one tile from each sector + the void tile in between.
    const player = fakePlayerWithTiles(sm, [
      map.ref(0, 0), // sector 1
      map.ref(2, 0), // void → sector 0, must NOT be counted
      map.ref(4, 0), // sector 2
    ]);

    expect(sm.playerOwnedSectorTiles(player)).toBe(2);
  });

  test("playerOwnedSectorTiles returns 0 for a player with no tiles", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const player = fakePlayerWithTiles(sm, []);

    expect(sm.playerOwnedSectorTiles(player)).toBe(0);
  });

  test("playerAverageHabitability is the unweighted mean across owned sector tiles", () => {
    // Mixed terrain: 1 OpenSpace + 1 Nebula + 1 AsteroidField
    //   habitability = (1.0 + 0.6 + 0.3) / 3 = 0.6333...
    const map = buildMap(3, 1, [OPEN, NEBULA, ASTEROID]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, [
      map.ref(0, 0),
      map.ref(1, 0),
      map.ref(2, 0),
    ]);

    const expected = (1.0 + 0.6 + 0.3) / 3;
    expect(sm.playerAverageHabitability(player)).toBeCloseTo(expected, 10);
  });

  test("playerAverageHabitability returns 1.0 when the player has no tiles", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, []);
    // 1.0 is the no-op identity for the (forthcoming) growth multiplier.
    expect(sm.playerAverageHabitability(player)).toBe(1.0);
  });

  test("playerAverageHabitability for an all-OpenSpace player is exactly 1.0", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, [
      map.ref(0, 0),
      map.ref(1, 0),
      map.ref(2, 0),
    ]);
    expect(sm.playerAverageHabitability(player)).toBe(1.0);
  });

  test("non-sector tiles are skipped, so a partial-debris player still averages over real planet tiles only", () => {
    // The economy formulas only care about livability of the sectors a
    // player controls — DebrisField/DeepSpace tiles fall outside any
    // sector so they're skipped entirely. With one OpenSpace sector tile
    // and one debris (non-sector) tile, the average is 1.0, not 0.5.
    const map = buildMap(2, 1, [OPEN, DEBRIS]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, [map.ref(0, 0), map.ref(1, 0)]);

    expect(sm.playerAverageHabitability(player)).toBe(1.0);
  });

  test("playerAverageHabitability returns 1.0 when no sector tiles are owned", () => {
    // Player owns only a non-sector debris tile → no sector tiles in the
    // average → fall back to the 1.0 no-op identity.
    const map = buildMap(2, 1, [OPEN, DEBRIS]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, [map.ref(1, 0)]);

    expect(sm.playerAverageHabitability(player)).toBe(1.0);
  });

  test("recordTileLost undoes a previous recordTileGained", () => {
    // Exercises the incremental-decrement path: player first gains two
    // tiles then loses one. The running totals should reflect only the
    // remaining tile.
    const map = buildMap(3, 1, [OPEN, NEBULA, ASTEROID]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, [map.ref(0, 0), map.ref(1, 0)]);
    expect(sm.playerOwnedSectorTiles(player)).toBe(2);
    expect(sm.playerAverageHabitability(player)).toBeCloseTo((1.0 + 0.6) / 2);

    sm.recordTileLost(player.smallID(), map.ref(1, 0));
    expect(sm.playerOwnedSectorTiles(player)).toBe(1);
    expect(sm.playerAverageHabitability(player)).toBe(1.0);
  });
});

describe("SectorMap habitability damage (LRW Ticket 5)", () => {
  test("applyHabitabilityDamage subtracts from effective habitability", () => {
    // Single OpenSpace tile (base hab 1.0). After 0.1 damage the effective
    // habitability should drop to 0.9.
    const map = buildMap(1, 1, [OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);

    expect(sm.effectiveHabitability(tile)).toBe(1.0);
    sm.applyHabitabilityDamage(tile, 0.1, null);
    expect(sm.effectiveHabitability(tile)).toBeCloseTo(0.9, 10);
    expect(sm.habitabilityDamageOf(tile)).toBeCloseTo(0.1, 10);
  });

  test("damage saturates at the base habitability and never goes negative", () => {
    // Asteroid base hab is 0.3 — applying 1.0 damage should clamp to 0,
    // not produce a negative habitability.
    const map = buildMap(1, 1, [ASTEROID]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);

    sm.applyHabitabilityDamage(tile, 1.0, null);
    expect(sm.effectiveHabitability(tile)).toBe(0);
    expect(sm.habitabilityDamageOf(tile)).toBeCloseTo(0.3, 10);

    // A second strike on a saturated tile is a no-op.
    sm.applyHabitabilityDamage(tile, 0.5, null);
    expect(sm.habitabilityDamageOf(tile)).toBeCloseTo(0.3, 10);
  });

  test("applyHabitabilityDamage decrements the owner's running sum by the delta", () => {
    // Single OpenSpace tile owned by a fake player. After applying 0.1
    // damage, the per-player average should drop from 1.0 to 0.9.
    const map = buildMap(1, 1, [OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);
    const player = fakePlayerWithTiles(sm, [tile]);

    expect(sm.playerAverageHabitability(player)).toBe(1.0);
    sm.applyHabitabilityDamage(tile, 0.1, player.smallID());
    expect(sm.playerAverageHabitability(player)).toBeCloseTo(0.9, 10);
  });

  test("applyHabitabilityDamage on a non-sector tile is a no-op", () => {
    // Damage applied to a debris tile (sector ID 0) shouldn't be recorded.
    const map = buildMap(2, 1, [OPEN, DEBRIS]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    sm.applyHabitabilityDamage(map.ref(1, 0), 0.5, null);
    expect(sm.habitabilityDamageOf(map.ref(1, 0))).toBe(0);
  });

  test("recordTileGained on a damaged tile contributes the reduced habitability", () => {
    // Apply damage first, *then* let a player gain the tile. The running
    // sum should reflect the post-damage habitability — without this the
    // average would silently use the undamaged base value.
    const map = buildMap(1, 1, [OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);

    sm.applyHabitabilityDamage(tile, 0.4, null);
    expect(sm.effectiveHabitability(tile)).toBeCloseTo(0.6, 10);

    const player = fakePlayerWithTiles(sm, [tile]);
    expect(sm.playerAverageHabitability(player)).toBeCloseTo(0.6, 10);
  });
});
