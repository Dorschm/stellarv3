// @vitest-environment node
import { Player, TerrainType } from "../../../src/core/game/Game";
import { GameMapImpl, TileRef } from "../../../src/core/game/GameMap";
import type { PlayerView } from "../../../src/core/game/GameView";
import {
  HABITABILITY_ASTEROID,
  HABITABILITY_NEBULA,
  HABITABILITY_OPEN_SPACE,
  habitabilityForTerrain,
  SECTOR_RESOURCE_MODIFIER_MAX,
  SECTOR_RESOURCE_MODIFIER_MIN,
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

/**
 * Minimal PlayerView stand-in. Unlike {@link fakePlayerWithTiles}, this does
 * NOT expose a `tiles()` method — it only carries the `smallID()` accessor
 * the SectorMap query path actually needs for a client-side view. Used by
 * the "PlayerView integration" test block below to lock in that
 * `playerOwnedSectorTiles` / `playerAverageHabitability` resolve by
 * `smallID()` for both `Player` and `PlayerView`.
 */
function fakePlayerViewWithSmallID(smallID: number): PlayerView {
  return {
    smallID: () => smallID,
  } as unknown as PlayerView;
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

  test("PlayerView resolves to real running totals by smallID", () => {
    // Regression: previously `playerSmallIDOrNull` returned `null` for any
    // player lacking a `tiles()` method, so PlayerView queries always fell
    // back to 0 / 1.0 even on real maps with populated sectors. Now that
    // GameView mirrors packed tile diffs into SectorMap, HUD consumers must
    // read the authoritative values by smallID.
    const map = buildMap(3, 1, [OPEN, NEBULA, ASTEROID]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    // Drive the running totals via the same smallID the view references.
    const sharedSmallID = _nextFakePlayerSmallID++;
    sm.recordTileGained(sharedSmallID, map.ref(0, 0));
    sm.recordTileGained(sharedSmallID, map.ref(1, 0));

    const view = fakePlayerViewWithSmallID(sharedSmallID);
    expect(sm.playerOwnedSectorTiles(view)).toBe(2);
    expect(sm.playerAverageHabitability(view)).toBeCloseTo((1.0 + 0.6) / 2);

    // Losing a tile should also be reflected in the PlayerView queries.
    sm.recordTileLost(sharedSmallID, map.ref(1, 0));
    expect(sm.playerOwnedSectorTiles(view)).toBe(1);
    expect(sm.playerAverageHabitability(view)).toBe(1.0);
  });

  test("PlayerView with no recorded tiles returns the no-op fallbacks", () => {
    // A PlayerView whose smallID has no running totals should still
    // collapse to the 0 / 1.0 identities that leave the economy formulas
    // unchanged — nothing should throw when the lookup misses.
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const unknownView = fakePlayerViewWithSmallID(999);
    expect(sm.playerOwnedSectorTiles(unknownView)).toBe(0);
    expect(sm.playerAverageHabitability(unknownView)).toBe(1.0);
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

describe("SectorMap resource modifiers (GDD §9)", () => {
  test("sectorResourceModifier returns a deterministic value in [0.5, 2.0)", () => {
    // Two 1-sector maps, same topology, same seed coordinates → the
    // modifier roll must agree. This guards against accidental
    // randomness (e.g. reaching for Math.random instead of the
    // PseudoRandom seeded from the sector ID).
    const mapA = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const smA = new SectorMap(mapA, [{ x: 0, y: 0 }]);
    const mapB = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const smB = new SectorMap(mapB, [{ x: 0, y: 0 }]);

    const modA = smA.sectorResourceModifier(1);
    const modB = smB.sectorResourceModifier(1);
    expect(modA).toBe(modB);
    expect(modA).toBeGreaterThanOrEqual(SECTOR_RESOURCE_MODIFIER_MIN);
    expect(modA).toBeLessThan(SECTOR_RESOURCE_MODIFIER_MAX);
  });

  test("different sector IDs produce different modifiers", () => {
    // Two disjoint sectors → the PRNG is re-seeded with a different ID
    // per sector, so the modifiers should almost certainly differ.
    // Accept a small collision risk by asserting NOT-equal rather than
    // pinning specific values; seeds 7919 and 15838 collide only under
    // a catastrophic PRNG failure, in which case the whole test suite
    // is already broken.
    const map = buildMap(5, 1, [OPEN, OPEN, VOID, OPEN, OPEN]);
    const sm = new SectorMap(map, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);

    const mod1 = sm.sectorResourceModifier(1);
    const mod2 = sm.sectorResourceModifier(2);
    expect(mod1).not.toBe(mod2);
    expect(mod1).toBeGreaterThanOrEqual(SECTOR_RESOURCE_MODIFIER_MIN);
    expect(mod1).toBeLessThan(SECTOR_RESOURCE_MODIFIER_MAX);
    expect(mod2).toBeGreaterThanOrEqual(SECTOR_RESOURCE_MODIFIER_MIN);
    expect(mod2).toBeLessThan(SECTOR_RESOURCE_MODIFIER_MAX);
  });

  test("sectorResourceModifier returns 1.0 for sector 0 and out-of-range IDs", () => {
    // 1.0 is the no-op identity for the volume bonus so callers that
    // look up "no sector" tiles don't get a spurious penalty or bonus.
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    expect(sm.sectorResourceModifier(0)).toBe(1.0);
    expect(sm.sectorResourceModifier(-1)).toBe(1.0);
    expect(sm.sectorResourceModifier(2)).toBe(1.0);
    expect(sm.sectorResourceModifier(999)).toBe(1.0);
  });

  test("playerWeightedYieldTiles sums (fullTiles + partialTiles) × sectorModifier across sectors", () => {
    // Two disjoint sectors. Player owns 2 OpenSpace tiles in sector 1
    // and 1 Nebula tile in sector 2. Uninhabitable tiles do NOT
    // contribute — we verify by also owning an AsteroidField tile in
    // sector 2 and asserting it doesn't affect the sum.
    //
    //   sector 1          sector 2
    //   OPEN OPEN  VOID  NEBULA ASTEROID
    const map = buildMap(5, 1, [OPEN, OPEN, VOID, NEBULA, ASTEROID]);
    const sm = new SectorMap(map, [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    const mod1 = sm.sectorResourceModifier(1);
    const mod2 = sm.sectorResourceModifier(2);

    const player = fakePlayerWithTiles(sm, [
      map.ref(0, 0), // sector 1, OpenSpace  → yielding
      map.ref(1, 0), // sector 1, OpenSpace  → yielding
      map.ref(3, 0), // sector 2, Nebula     → yielding
      map.ref(4, 0), // sector 2, Asteroid   → uninhabitable, excluded
    ]);

    // Expected: 2 × mod1 + 1 × mod2 (Asteroid excluded).
    const expected = 2 * mod1 + 1 * mod2;
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(expected, 10);
  });

  test("playerWeightedYieldTiles returns 0 for a player with no tiles", () => {
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const player = fakePlayerWithTiles(sm, []);
    expect(sm.playerWeightedYieldTiles(player)).toBe(0);
  });

  test("recordTileLost subtracts the sector modifier from the weighted sum", () => {
    // Gain 2 OpenSpace tiles, then lose 1 — weighted sum should drop
    // by exactly one sector-1 modifier.
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const mod1 = sm.sectorResourceModifier(1);

    const player = fakePlayerWithTiles(sm, [map.ref(0, 0), map.ref(1, 0)]);
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(2 * mod1, 10);

    sm.recordTileLost(player.smallID(), map.ref(1, 0));
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(1 * mod1, 10);
  });

  test("recordTileLost on the last tile zeros the weighted sum", () => {
    // The last-tile branch resets bucket counters explicitly — the
    // weighted sum must be reset alongside them so float drift can't
    // leak across an ownership wipe.
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);

    const player = fakePlayerWithTiles(sm, [map.ref(0, 0)]);
    expect(sm.playerWeightedYieldTiles(player)).toBeGreaterThan(0);

    sm.recordTileLost(player.smallID(), map.ref(0, 0));
    expect(sm.playerWeightedYieldTiles(player)).toBe(0);
  });

  test("applyHabitabilityDamage subtracts the modifier when a yielding tile becomes uninhabitable", () => {
    // Single OpenSpace tile owned by a player — the weighted sum
    // should start at mod1, then drop to 0 after enough damage lands
    // the tile in the uninhabitable bucket.
    const map = buildMap(1, 1, [OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);
    const mod1 = sm.sectorResourceModifier(1);

    const player = fakePlayerWithTiles(sm, [tile]);
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(mod1, 10);

    // 1.0 base − 0.9 damage = 0.1 effective → below uninhab threshold.
    sm.applyHabitabilityDamage(tile, 0.9, player.smallID());
    expect(sm.playerWeightedYieldTiles(player)).toBe(0);
  });

  test("applyHabitabilityDamage is a no-op on the weighted sum when the damage stays within a yielding bucket", () => {
    // OpenSpace → Nebula-ish (0.7 effective) is still a "yielding"
    // bucket swap (full → partial). The weighted sum must NOT change
    // because both buckets count equally toward credit yield.
    const map = buildMap(1, 1, [OPEN]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);
    const mod1 = sm.sectorResourceModifier(1);

    const player = fakePlayerWithTiles(sm, [tile]);
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(mod1, 10);

    // 1.0 → 0.7 effective (full → partial bucket). Still yielding.
    sm.applyHabitabilityDamage(tile, 0.3, player.smallID());
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(mod1, 10);
  });

  test("recomputeHabitabilityForTile adds the modifier when a tile is terraformed uninhabitable → partial", () => {
    // Start with an AsteroidField tile (uninhabitable → not in the
    // weighted sum), then simulate a Scout Swarm terraforming it to
    // Nebula. The caller reports the pre-mutation effective hab (0.3),
    // the underlying terrain is flipped, then recomputeHabitabilityForTile
    // is called. The weighted sum should jump by one sector-1 modifier.
    const map = buildMap(1, 1, [ASTEROID]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);
    const mod1 = sm.sectorResourceModifier(1);

    const player = fakePlayerWithTiles(sm, [tile]);
    // Asteroid is uninhabitable → not counted in the weighted sum.
    expect(sm.playerWeightedYieldTiles(player)).toBe(0);

    // Terraform: flip the underlying terrain to Nebula and notify
    // SectorMap with the pre-mutation effective habitability.
    const prevHab = sm.effectiveHabitability(tile);
    map.setTerrainType(tile, TerrainType.Nebula);
    sm.recomputeHabitabilityForTile(tile, player.smallID(), prevHab);

    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(mod1, 10);
  });

  test("recomputeHabitabilityForTile stays a no-op on the weighted sum when the bucket crossing is yielding ↔ yielding", () => {
    // Nebula → OpenSpace is a partial → full transition. The tile was
    // already yielding; it is still yielding. The weighted sum must
    // not double-count.
    const map = buildMap(1, 1, [NEBULA]);
    const sm = new SectorMap(map, [{ x: 0, y: 0 }]);
    const tile = map.ref(0, 0);
    const mod1 = sm.sectorResourceModifier(1);

    const player = fakePlayerWithTiles(sm, [tile]);
    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(mod1, 10);

    const prevHab = sm.effectiveHabitability(tile);
    map.setTerrainType(tile, TerrainType.OpenSpace);
    sm.recomputeHabitabilityForTile(tile, player.smallID(), prevHab);

    expect(sm.playerWeightedYieldTiles(player)).toBeCloseTo(mod1, 10);
  });
});
