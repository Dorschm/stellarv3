// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateProceduralMapData } from "../../../src/core/game/ProceduralMapGen";

const IS_LAND_BIT = 1 << 7;
const VOID_BIT = 1 << 5;
const MAGNITUDE_MASK = 0x1f;

describe("ProceduralMapGen", () => {
  it("generates valid terrain with correct dimensions", async () => {
    const mapData = generateProceduralMapData({
      seed: 42,
      playerCount: 4,
      width: 100,
      height: 100,
    });

    const manifest = await mapData.manifest();
    expect(manifest.map.width).toBe(100);
    expect(manifest.map.height).toBe(100);

    const terrain = await mapData.mapBin();
    expect(terrain.length).toBe(100 * 100);
  });

  it("produces sector tiles with valid terrain types", async () => {
    const mapData = generateProceduralMapData({
      seed: 123,
      playerCount: 3,
      width: 100,
      height: 100,
    });

    const terrain = await mapData.mapBin();
    let sectorCount = 0;
    let openSpace = 0;
    let nebula = 0;
    let asteroid = 0;

    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] & IS_LAND_BIT) {
        sectorCount++;
        const mag = terrain[i] & MAGNITUDE_MASK;
        if (mag < 10) openSpace++;
        else if (mag < 20) nebula++;
        else asteroid++;
      }
    }

    // Should have some sector tiles
    expect(sectorCount).toBeGreaterThan(0);

    const manifest = await mapData.manifest();
    expect(manifest.map.num_land_tiles).toBe(sectorCount);

    // Should have a mix of terrain types
    expect(openSpace).toBeGreaterThan(0);
    // Nebula and asteroid should exist (probabilistic, but with enough tiles...)
    expect(nebula + asteroid).toBeGreaterThan(0);
  });

  it("generates reproducible maps from the same seed", async () => {
    const opts = { seed: 999, playerCount: 4, width: 80, height: 80 };
    const map1 = generateProceduralMapData(opts);
    const map2 = generateProceduralMapData(opts);

    const terrain1 = await map1.mapBin();
    const terrain2 = await map2.mapBin();

    expect(terrain1.length).toBe(terrain2.length);
    for (let i = 0; i < terrain1.length; i++) {
      expect(terrain1[i]).toBe(terrain2[i]);
    }

    const manifest1 = await map1.manifest();
    const manifest2 = await map2.manifest();
    expect(manifest1.nations.length).toBe(manifest2.nations.length);
    for (let i = 0; i < manifest1.nations.length; i++) {
      expect(manifest1.nations[i].coordinates).toEqual(
        manifest2.nations[i].coordinates,
      );
    }
  });

  it("generates different maps from different seeds", async () => {
    const opts1 = { seed: 111, playerCount: 4, width: 80, height: 80 };
    const opts2 = { seed: 222, playerCount: 4, width: 80, height: 80 };
    const terrain1 = await generateProceduralMapData(opts1).mapBin();
    const terrain2 = await generateProceduralMapData(opts2).mapBin();

    let differences = 0;
    for (let i = 0; i < terrain1.length; i++) {
      if (terrain1[i] !== terrain2[i]) differences++;
    }
    // Maps should differ significantly
    expect(differences).toBeGreaterThan(terrain1.length * 0.1);
  });

  it("generates nations at sector centers", async () => {
    const mapData = generateProceduralMapData({
      seed: 42,
      playerCount: 4,
      width: 200,
      height: 200,
    });

    const manifest = await mapData.manifest();
    const terrain = await mapData.mapBin();

    // Should have at least 2 nations
    expect(manifest.nations.length).toBeGreaterThanOrEqual(2);

    // Each nation coordinate should be within the map bounds
    for (const nation of manifest.nations) {
      expect(nation.coordinates[0]).toBeGreaterThanOrEqual(0);
      expect(nation.coordinates[0]).toBeLessThan(200);
      expect(nation.coordinates[1]).toBeGreaterThanOrEqual(0);
      expect(nation.coordinates[1]).toBeLessThan(200);

      // Nation center should be a sector tile
      const ref = nation.coordinates[1] * 200 + nation.coordinates[0];
      expect(terrain[ref] & IS_LAND_BIT).toBeTruthy();
    }
  });

  it("generates valid downsampled maps", async () => {
    const mapData = generateProceduralMapData({
      seed: 42,
      playerCount: 4,
      width: 100,
      height: 100,
    });

    const manifest = await mapData.manifest();
    const map4x = await mapData.map4xBin();
    const map16x = await mapData.map16xBin();

    expect(manifest.map4x.width).toBe(50);
    expect(manifest.map4x.height).toBe(50);
    expect(map4x.length).toBe(50 * 50);

    expect(manifest.map16x.width).toBe(25);
    expect(manifest.map16x.height).toBe(25);
    expect(map16x.length).toBe(25 * 25);

    // Downsampled maps should have some sector tiles
    expect(manifest.map4x.num_land_tiles).toBeGreaterThan(0);
    expect(manifest.map16x.num_land_tiles).toBeGreaterThan(0);
  });

  it("works with SectorMap (BFS integration)", async () => {
    // Import SectorMap to verify the generated maps are compatible
    const { SectorMap } = await import("../../../src/core/game/SectorMap");
    const { GameMapImpl } = await import("../../../src/core/game/GameMap");

    const mapData = generateProceduralMapData({
      seed: 42,
      playerCount: 4,
      width: 100,
      height: 100,
    });

    const manifest = await mapData.manifest();
    const terrain = await mapData.mapBin();

    const gameMap = new GameMapImpl(
      manifest.map.width,
      manifest.map.height,
      terrain,
      manifest.map.num_land_tiles,
    );

    const seeds = manifest.nations.map((n) => ({
      x: n.coordinates[0],
      y: n.coordinates[1],
    }));

    const sectorMap = new SectorMap(gameMap, seeds);

    // Should detect sectors
    expect(sectorMap.numSectors()).toBeGreaterThanOrEqual(2);

    // Each nation's center tile should be in a sector
    for (let i = 0; i < seeds.length; i++) {
      const ref = gameMap.ref(seeds[i].x, seeds[i].y);
      expect(sectorMap.sectorOf(ref)).toBe(i + 1);
    }
  });

  it("has non-sector tiles between sectors", async () => {
    const mapData = generateProceduralMapData({
      seed: 42,
      playerCount: 4,
      width: 100,
      height: 100,
    });

    const terrain = await mapData.mapBin();
    let voidCount = 0;
    let debrisCount = 0;

    for (let i = 0; i < terrain.length; i++) {
      if (!(terrain[i] & IS_LAND_BIT)) {
        if (terrain[i] & VOID_BIT) voidCount++;
        else debrisCount++;
      }
    }

    // Should have deep space and debris between sectors
    expect(voidCount).toBeGreaterThan(0);
    expect(debrisCount).toBeGreaterThan(0);
  });
});
