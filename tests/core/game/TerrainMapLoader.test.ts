// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BinaryLoaderGameMapLoader } from "../../../src/core/game/BinaryLoaderGameMapLoader";
import { GameMapSize, GameMapType } from "../../../src/core/game/Game";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";

describe("loadTerrainMap with random maps", () => {
  // Regression: two separate runs (e.g. client main thread + web worker, or
  // two clients in a multiplayer game) must resolve to the *same* terrain
  // when both pass the same gameID-derived seed. Without seed plumbing, the
  // loader fell back to Date.now() and the two sides desynced — spawn clicks
  // failed silently and nation labels rendered over the wrong terrain.
  it("returns identical terrain for the same seed across loader instances", async () => {
    const loaderA = new BinaryLoaderGameMapLoader();
    const loaderB = new BinaryLoaderGameMapLoader();

    const seed = 0xc0ffee;
    const mapA = await loadTerrainMap(
      GameMapType.Random,
      GameMapSize.Normal,
      loaderA,
      seed,
    );
    const mapB = await loadTerrainMap(
      GameMapType.Random,
      GameMapSize.Normal,
      loaderB,
      seed,
    );

    expect(mapA.gameMap.width()).toBe(mapB.gameMap.width());
    expect(mapA.gameMap.height()).toBe(mapB.gameMap.height());
    expect(mapA.gameMap.numSectorTiles()).toBe(mapB.gameMap.numSectorTiles());

    expect(mapA.nations.length).toBe(mapB.nations.length);
    for (let i = 0; i < mapA.nations.length; i++) {
      expect(mapA.nations[i].coordinates).toEqual(mapB.nations[i].coordinates);
      expect(mapA.nations[i].name).toBe(mapB.nations[i].name);
    }
  });

  it("returns different terrain for different seeds", async () => {
    const loader = new BinaryLoaderGameMapLoader();

    const map1 = await loadTerrainMap(
      GameMapType.Random,
      GameMapSize.Normal,
      loader,
      111,
    );
    const map2 = await loadTerrainMap(
      GameMapType.Random,
      GameMapSize.Normal,
      loader,
      222,
    );

    const nation1Coords = map1.nations.map((n) => n.coordinates.join(","));
    const nation2Coords = map2.nations.map((n) => n.coordinates.join(","));
    expect(nation1Coords).not.toEqual(nation2Coords);
  });
});
