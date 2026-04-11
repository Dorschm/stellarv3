// @vitest-environment node
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { buildPlanets, Planet } from "../../../src/core/game/Planet";
import { SectorMap } from "../../../src/core/game/SectorMap";

/**
 * Focused unit coverage for {@link Planet.resourceModifier} — locks in the
 * Planet→SectorMap wiring required by the "Planet resource modifier"
 * ticket. The SectorMap-level behaviour is already covered in
 * `SectorMap.test.ts`; these tests sit one layer up and guarantee the
 * `Planet` façade returns whatever `sectorMap.sectorResourceModifier(id)`
 * returns, for each planet built by {@link buildPlanets}.
 *
 * Without this file, a future refactor that swapped PlanetImpl's wiring
 * (e.g. caching a stale value at construction time, or looking the
 * modifier up by the wrong id) could silently break HUD/gameplay
 * consumers without any unit-level signal.
 */

// Terrain bit layout — mirrors the private constants in GameMapImpl and
// matches the helpers already used in `SectorMap.test.ts`.
const LAND_BIT = 1 << 7;
const VOID_BIT = 1 << 5;

/** Open-space sector tile (habitability 1.0). */
const OPEN = LAND_BIT | 5;
/** Deep space (non-sector void). */
const VOID = VOID_BIT;

/**
 * Builds a `GameMapImpl` from a flat row-major terrain byte array.
 * Lifted straight from `SectorMap.test.ts` so both suites share the
 * exact same construction path and a regression can't slip in via a
 * divergent helper.
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

describe("Planet.resourceModifier", () => {
  test("matches SectorMap.sectorResourceModifier for the planet's sector id", () => {
    // Single-sector map with one nation seed → buildPlanets should
    // produce exactly one Planet whose resourceModifier() delegates
    // verbatim to sectorMap.sectorResourceModifier(1).
    const map = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sectorMap = new SectorMap(map, [{ x: 0, y: 0 }]);
    const planets = buildPlanets(sectorMap, map, [
      { name: "Alpha", coordinates: [0, 0] },
    ]);

    expect(planets).toHaveLength(1);
    const planet = planets[0];
    expect(planet.sectorId).toBe(1);
    expect(planet.resourceModifier()).toBe(
      sectorMap.sectorResourceModifier(planet.sectorId),
    );
  });

  test("modifiers differ per sector and each Planet delegates to its own sector id", () => {
    // Two disjoint sectors split by a VOID column. The PRNG is re-seeded
    // per sector id, so sector 1 and sector 2 produce distinct modifiers.
    // Both Planets must return exactly the SectorMap value keyed on
    // their own sectorId — never swapped, never cached.
    //
    //   sector 1        sector 2
    //   OPEN OPEN  VOID  OPEN OPEN
    const map = buildMap(5, 1, [OPEN, OPEN, VOID, OPEN, OPEN]);
    const sectorMap = new SectorMap(map, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    const planets = buildPlanets(sectorMap, map, [
      { name: "Alpha", coordinates: [0, 0] },
      { name: "Beta", coordinates: [4, 0] },
    ]);

    expect(planets).toHaveLength(2);
    const [alpha, beta] = planets;
    expect(alpha.sectorId).toBe(1);
    expect(beta.sectorId).toBe(2);

    const modA = sectorMap.sectorResourceModifier(1);
    const modB = sectorMap.sectorResourceModifier(2);
    expect(alpha.resourceModifier()).toBe(modA);
    expect(beta.resourceModifier()).toBe(modB);
    // Guards the "different sector ids can yield different modifiers"
    // half of the ticket acceptance criteria. The underlying PRNG is
    // seeded from the sector id, so a collision here would mean the
    // whole determinism story is broken.
    expect(alpha.resourceModifier()).not.toBe(beta.resourceModifier());
  });

  test("resourceModifier is deterministic across calls and across map rebuilds", () => {
    // Two identical maps built independently must produce the same
    // modifier for planets wrapping the same sector id, and repeated
    // calls on the same Planet must never drift — Planet must read
    // through to SectorMap every time rather than caching a stale roll.
    const mapA = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sectorMapA = new SectorMap(mapA, [{ x: 0, y: 0 }]);
    const [planetA] = buildPlanets(sectorMapA, mapA, [
      { name: "Alpha", coordinates: [0, 0] },
    ]);

    const mapB = buildMap(3, 1, [OPEN, OPEN, OPEN]);
    const sectorMapB = new SectorMap(mapB, [{ x: 0, y: 0 }]);
    const [planetB] = buildPlanets(sectorMapB, mapB, [
      { name: "Alpha", coordinates: [0, 0] },
    ]);

    const first = planetA.resourceModifier();
    expect(planetA.resourceModifier()).toBe(first);
    expect(planetB.resourceModifier()).toBe(first);
  });

  test("resourceModifier matches SectorMap for every planet built from a multi-sector map", () => {
    // Loop-based parity check: for each Planet produced by buildPlanets,
    // planet.resourceModifier() must equal sectorMap.sectorResourceModifier(
    // planet.sectorId). This is the invariant the ticket asks us to lock
    // in, expressed directly as a test.
    const map = buildMap(5, 1, [OPEN, OPEN, VOID, OPEN, OPEN]);
    const sectorMap = new SectorMap(map, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    const planets: Planet[] = buildPlanets(sectorMap, map, [
      { name: "Alpha", coordinates: [0, 0] },
      { name: "Beta", coordinates: [4, 0] },
    ]);

    expect(planets.length).toBeGreaterThanOrEqual(2);
    for (const planet of planets) {
      expect(planet.resourceModifier()).toBe(
        sectorMap.sectorResourceModifier(planet.sectorId),
      );
    }
  });
});
