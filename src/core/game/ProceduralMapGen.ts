import { PseudoRandom } from "../PseudoRandom";
import { MapData } from "./GameMapLoader";
import { MapManifest, Nation } from "./TerrainMapLoader";

/**
 * Procedural galaxy map generator. Produces in-memory map data
 * (terrain Uint8Arrays + manifest) at runtime from a numeric seed,
 * yielding a unique map every run while being fully reproducible
 * (same seed = same map).
 *
 * See GDD §9 — Star Systems: 1-8 celestial objects, random landmass,
 * ~10% partial habitability, random resource modifier, unique maps.
 */

// ── Terrain byte packing (mirrors map-generator/map_generator.go) ─────
const IS_LAND_BIT = 7; // bit 7: 1 = sector (land), 0 = non-sector
const SHORELINE_BIT = 6; // bit 6: sector boundary
const VOID_BIT = 5; // bit 5: deep space (void)
// Bits 0-4: magnitude (0-31)
//   Sector tiles: <10 = OpenSpace, 10-19 = Nebula, >=20 = AsteroidField
//   Non-sector:   distance-based (not used by procedural gen)

/** Default map dimensions (matches Sol System scale). */
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 1500;

/** Sector blob spoke count for irregular boundary generation. */
const NUM_SPOKES = 16;

/** Nation name pool for procedural sectors. */
const NATION_NAMES = [
  "Alpha Centauri",
  "Betelgeuse Dominion",
  "Cygnus Collective",
  "Delta Pavonis",
  "Epsilon Eridani",
  "Formalhaut Reach",
  "Gamma Draconis",
  "Hydra Expanse",
  "Ithaca Nebula",
  "Jovian Federation",
  "Kepler Consortium",
  "Lyra Sovereignty",
  "Mintaka Union",
  "Nova Terra",
  "Orion Vanguard",
  "Polaris Accord",
];

export interface ProceduralMapOptions {
  seed: number;
  playerCount?: number;
  width?: number;
  height?: number;
}

interface SectorBlob {
  cx: number;
  cy: number;
  spokeRadii: number[];
  nationName: string;
}

/**
 * Generate a complete procedural map and return it as a {@link MapData}
 * compatible with the existing `GameMapLoader` / `TerrainMapLoader` pipeline.
 */
export function generateProceduralMapData(
  options: ProceduralMapOptions,
): MapData {
  const { seed, playerCount = 4 } = options;
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;

  const rng = new PseudoRandom(seed);

  // Number of sectors: 2-8, scaled by player count
  const numSectors = Math.max(2, Math.min(8, playerCount + rng.nextInt(0, 3)));

  // ── Place sector centers ────────────────────────────────────────────
  const margin = Math.floor(Math.min(width, height) * 0.12);
  const sectorBlobs = placeSectors(rng, numSectors, width, height, margin);

  // ── Average sector radius based on map size and sector count ────────
  const mapArea = width * height;
  // Target ~16% of map area as sector tiles total
  const targetSectorArea = mapArea * 0.16;
  const avgSectorArea = targetSectorArea / numSectors;
  const avgRadius = Math.sqrt(avgSectorArea / Math.PI);

  // Generate spoke radii per sector
  for (const blob of sectorBlobs) {
    blob.spokeRadii = [];
    for (let i = 0; i < NUM_SPOKES; i++) {
      blob.spokeRadii.push(avgRadius * rng.nextFloat(0.6, 1.4));
    }
  }

  // ── Build terrain array ─────────────────────────────────────────────
  const result = buildTerrainArray(rng, sectorBlobs, width, height);

  // ── Build downsampled versions ──────────────────────────────────────
  const w4x = Math.floor(width / 2);
  const h4x = Math.floor(height / 2);
  const result4x = downsample(result.terrain, width, height, 2);

  const w16x = Math.floor(width / 4);
  const h16x = Math.floor(height / 4);
  const result16x = downsample(result.terrain, width, height, 4);

  // ── Build nations ───────────────────────────────────────────────────
  const nations: Nation[] = sectorBlobs.map((blob) => ({
    coordinates: [blob.cx, blob.cy] as [number, number],
    flag: "",
    name: blob.nationName,
  }));

  // ── Assemble manifest ──────────────────────────────────────────────
  const manifest: MapManifest = {
    name: `Random Galaxy (seed ${seed})`,
    map: {
      width,
      height,
      num_land_tiles: result.numSectorTiles,
    },
    map4x: {
      width: w4x,
      height: h4x,
      num_land_tiles: countSectorTiles(result4x),
    },
    map16x: {
      width: w16x,
      height: h16x,
      num_land_tiles: countSectorTiles(result16x),
    },
    nations,
  };

  return {
    mapBin: () => Promise.resolve(result.terrain),
    map4xBin: () => Promise.resolve(result4x),
    map16xBin: () => Promise.resolve(result16x),
    manifest: () => Promise.resolve(manifest),
    webpPath: "",
  };
}

// ── Internal helpers ──────────────────────────────────────────────────

/** Place sector centers with minimum separation. */
function placeSectors(
  rng: PseudoRandom,
  count: number,
  width: number,
  height: number,
  margin: number,
): SectorBlob[] {
  const blobs: SectorBlob[] = [];
  const minDist = Math.min(width, height) * 0.18;
  const names = rng.shuffleArray([...NATION_NAMES]);

  for (
    let attempt = 0;
    blobs.length < count && attempt < count * 50;
    attempt++
  ) {
    const cx = rng.nextInt(margin, width - margin);
    const cy = rng.nextInt(margin, height - margin);

    const tooClose = blobs.some((b) => {
      const dx = b.cx - cx;
      const dy = b.cy - cy;
      return Math.sqrt(dx * dx + dy * dy) < minDist;
    });
    if (tooClose) continue;

    blobs.push({
      cx,
      cy,
      spokeRadii: [],
      nationName: names[blobs.length % names.length],
    });
  }
  return blobs;
}

/**
 * Build the full-resolution terrain Uint8Array.
 *
 * Each byte encodes:
 *  - bit 7: is sector (land)
 *  - bit 6: sector boundary (shoreline)
 *  - bit 5: void (deep space)
 *  - bits 0-4: magnitude
 */
function buildTerrainArray(
  rng: PseudoRandom,
  blobs: SectorBlob[],
  width: number,
  height: number,
): { terrain: Uint8Array; numSectorTiles: number } {
  const size = width * height;
  const terrain = new Uint8Array(size);
  let numSectorTiles = 0;

  // Pass 1: determine sector membership + magnitude
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      const inSector = isInAnySector(blobs, x, y);

      if (inSector) {
        // Sector tile
        const magnitude = sectorMagnitude(rng, blobs, x, y);
        terrain[idx] = (1 << IS_LAND_BIT) | (magnitude & 0x1f);
        numSectorTiles++;
      } else {
        // Non-sector: 80% deep space (void), 20% debris field
        if (rng.nextInt(0, 5) < 4) {
          terrain[idx] = 1 << VOID_BIT; // deep space
        } else {
          terrain[idx] = 0; // debris field (no flags set)
        }
      }
    }
  }

  // Pass 2: mark shoreline (sector tiles adjacent to non-sector)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (!(terrain[idx] & (1 << IS_LAND_BIT))) continue;

      // Check 4-connected neighbors
      const neighbors = [
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && !(terrain[n] & (1 << IS_LAND_BIT))) {
          terrain[idx] |= 1 << SHORELINE_BIT;
          break;
        }
      }
    }
  }

  return { terrain, numSectorTiles };
}

/** Check if (x,y) lies inside any sector blob's irregular boundary. */
function isInAnySector(blobs: SectorBlob[], x: number, y: number): boolean {
  for (const blob of blobs) {
    const dx = x - blob.cx;
    const dy = y - blob.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Compute angle and interpolate spoke radii
    const angle = Math.atan2(dy, dx) + Math.PI; // 0 to 2*PI
    const spokeIdx = (angle / (2 * Math.PI)) * NUM_SPOKES;
    const lo = Math.floor(spokeIdx) % NUM_SPOKES;
    const hi = (lo + 1) % NUM_SPOKES;
    const t = spokeIdx - Math.floor(spokeIdx);
    const effectiveRadius =
      blob.spokeRadii[lo] * (1 - t) + blob.spokeRadii[hi] * t;

    if (dist <= effectiveRadius) return true;
  }
  return false;
}

/**
 * Determine the magnitude (0-31) for a sector tile based on its position
 * relative to the nearest sector center. Produces ~70% OpenSpace (mag <10),
 * ~20% Nebula (mag 10-19), ~10% AsteroidField (mag >=20).
 */
function sectorMagnitude(
  rng: PseudoRandom,
  blobs: SectorBlob[],
  x: number,
  y: number,
): number {
  // Find nearest sector center
  let minDist = Infinity;
  let nearestBlob: SectorBlob = blobs[0];
  for (const blob of blobs) {
    const dx = x - blob.cx;
    const dy = y - blob.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) {
      minDist = d;
      nearestBlob = blob;
    }
  }

  // Average radius of the nearest sector
  const avgR = nearestBlob.spokeRadii.reduce((a, b) => a + b, 0) / NUM_SPOKES;
  // Normalized distance from center (0 = center, 1 = edge)
  const normalizedDist = Math.min(1, minDist / Math.max(1, avgR));

  // Interior tiles: mostly OpenSpace.  Edge tiles: more Nebula/Asteroid.
  // Add randomness for variety.
  const edgeFactor = normalizedDist * normalizedDist; // quadratic → dense core
  const noise = rng.nextFloat(0, 1);

  // ~10% of all sector tiles should be partial habitability (Nebula/Asteroid)
  // Core (edgeFactor < 0.3): almost always OpenSpace
  // Mid (0.3-0.7): mix
  // Edge (>0.7): higher chance of Nebula/Asteroid
  if (edgeFactor > 0.7 || (edgeFactor > 0.3 && noise < 0.15) || noise < 0.05) {
    // Nebula or Asteroid
    if (noise < 0.4) {
      return rng.nextInt(20, 28); // AsteroidField
    }
    return rng.nextInt(10, 19); // Nebula
  }
  return rng.nextInt(0, 9); // OpenSpace
}

/**
 * Downsample terrain by `factor` (2 for map4x, 4 for map16x).
 * Each output tile takes the value of the corresponding source tile at
 * (x*factor, y*factor), with shoreline bits recomputed.
 */
function downsample(
  source: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  factor: number,
): Uint8Array {
  const dstWidth = Math.floor(srcWidth / factor);
  const dstHeight = Math.floor(srcHeight / factor);
  const dst = new Uint8Array(dstWidth * dstHeight);

  // Sample from the source
  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = dx * factor;
      const sy = dy * factor;
      // Copy the source tile byte but clear the shoreline bit — recomputed below
      dst[dy * dstWidth + dx] =
        source[sy * srcWidth + sx] & ~(1 << SHORELINE_BIT);
    }
  }

  // Recompute shoreline for the downsampled map
  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      const idx = dy * dstWidth + dx;
      if (!(dst[idx] & (1 << IS_LAND_BIT))) continue;
      const neighbors = [
        dy > 0 ? idx - dstWidth : -1,
        dy < dstHeight - 1 ? idx + dstWidth : -1,
        dx > 0 ? idx - 1 : -1,
        dx < dstWidth - 1 ? idx + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && !(dst[n] & (1 << IS_LAND_BIT))) {
          dst[idx] |= 1 << SHORELINE_BIT;
          break;
        }
      }
    }
  }

  return dst;
}

/** Count sector (land) tiles in a packed terrain array. */
function countSectorTiles(terrain: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] & (1 << IS_LAND_BIT)) count++;
  }
  return count;
}
