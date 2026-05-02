import { FetchGameMapLoader } from "src/core/game/FetchGameMapLoader";
import { GameMapType } from "src/core/game/Game";
import { GameMapLoader } from "src/core/game/GameMapLoader";
import { logger } from "./Logger";

let mapLoader: GameMapLoader | null = null;

const log = logger.child({ component: "MapSectorTiles" });

// Gets or creates the map loader, uses FetchGameMapLoader pointing to the master server.
function getMapLoader(): GameMapLoader {
  mapLoader ??= new FetchGameMapLoader("http://localhost:3000/maps");
  return mapLoader;
}

// Gets the number of sector tiles for a map (i.e. tiles that are part of any
// habitable Sector — not DeepSpace — see CLAUDE.md theme reference).
// FetchGameMapLoader already caches maps, so no need for additional caching here.
export async function getMapSectorTiles(map: GameMapType): Promise<number> {
  try {
    const loader = getMapLoader();
    const mapData = loader.getMapData(map);
    const manifest = await mapData.manifest();
    return manifest.map.num_sector_tiles;
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
