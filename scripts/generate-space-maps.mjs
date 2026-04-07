/**
 * Generate space map binary terrain assets for StellarGame.
 *
 * Terrain byte encoding (from GameMap.ts):
 *   Bit 7 (0x80) = IS_LAND
 *   Bit 6 (0x40) = SHORELINE
 *   Bit 5 (0x20) = OCEAN
 *   Bits 0-4     = magnitude (0-31)
 *
 * TerrainType classification (from GameMap.terrainType):
 *   Plains:   land + magnitude 0-9
 *   Highland: land + magnitude 10-19
 *   Mountain: land + magnitude 20-31
 *   Ocean:    water + ocean bit set
 *   Lake:     water + ocean bit clear
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAPS_DIR = path.join(__dirname, "..", "resources", "maps");

// Terrain byte helpers
const IS_LAND = 0x80;
const SHORELINE = 0x40;
const OCEAN = 0x20;

function deepSpace(mag = 5) {
  return OCEAN | (mag & 0x1f);
}
function plains(mag = 3) {
  return IS_LAND | (mag & 0x09);
}
function highland(mag = 12) {
  return IS_LAND | (mag & 0x1f);
}
function mountain(mag = 22) {
  return IS_LAND | (mag & 0x1f);
}

/**
 * Generate a terrain map with planetary zones.
 *
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {{coordinates: [number,number], name: string}[]} nations - Planet centers
 * @param {number} planetRadius - Base planet radius in tiles
 */
function generateMap(width, height, nations, planetRadius) {
  const data = new Uint8Array(width * height);
  let numLand = 0;

  // First pass: fill everything with deep space
  for (let i = 0; i < data.length; i++) {
    data[i] = deepSpace(5);
  }

  // Second pass: draw planetary circles for each nation
  for (const nation of nations) {
    const [cx, cy] = nation.coordinates;
    const r = planetRadius;
    // Vary planet radii slightly for visual interest
    const rSq = r * r;

    const xMin = Math.max(0, Math.floor(cx - r - 1));
    const xMax = Math.min(width - 1, Math.ceil(cx + r + 1));
    const yMin = Math.max(0, Math.floor(cy - r - 1));
    const yMax = Math.min(height - 1, Math.ceil(cy + r + 1));

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);
        const normDist = dist / r; // 0 at center, 1 at edge

        if (normDist <= 1.0) {
          const idx = y * width + x;

          // Terrain variety based on distance from center
          if (normDist < 0.55) {
            // Inner zone: plains (magnitude 0-9)
            const mag = Math.floor(normDist * 16); // 0-8
            data[idx] = plains(Math.min(mag, 9));
          } else if (normDist < 0.80) {
            // Middle ring: highland (magnitude 10-19)
            const mag = 10 + Math.floor((normDist - 0.55) * 36); // 10-18
            data[idx] = highland(Math.min(mag, 19));
          } else if (normDist < 0.90) {
            // Outer ring: scattered mountain peaks (magnitude 20-25)
            // Use a pseudo-random pattern based on position
            const hash = ((x * 7919 + y * 6271) % 100);
            if (hash < 40) {
              const mag = 20 + Math.floor((normDist - 0.80) * 50);
              data[idx] = mountain(Math.min(mag, 25));
            } else {
              const mag = 10 + Math.floor((normDist - 0.80) * 90);
              data[idx] = highland(Math.min(mag, 19));
            }
          } else {
            // Edge: plains transitioning to space
            const mag = Math.floor((1.0 - normDist) * 90); // 0-9
            data[idx] = plains(Math.min(Math.max(mag, 0), 9));
          }
        }
      }
    }
  }

  // Third pass: add void pockets (lakes) scattered on planets
  // Small circular voids within planet terrain for gameplay variety
  for (const nation of nations) {
    const [cx, cy] = nation.coordinates;
    const r = planetRadius;
    // Place 2-4 small void pockets per planet
    const numVoids = 2 + ((cx * 31 + cy * 17) % 3);
    for (let v = 0; v < numVoids; v++) {
      // Deterministic "random" positions within the planet
      const angle = (v * 2.39996 + cx * 0.01 + cy * 0.007); // golden angle offset
      const voidDist = r * (0.3 + (v * 0.15) % 0.35);
      const vx = Math.round(cx + Math.cos(angle) * voidDist);
      const vy = Math.round(cy + Math.sin(angle) * voidDist);
      const voidR = Math.max(3, Math.floor(r * 0.05));

      for (let y = Math.max(0, vy - voidR); y <= Math.min(height - 1, vy + voidR); y++) {
        for (let x = Math.max(0, vx - voidR); x <= Math.min(width - 1, vx + voidR); x++) {
          const dx = x - vx;
          const dy = y - vy;
          if (dx * dx + dy * dy <= voidR * voidR) {
            const idx = y * width + x;
            // Only place void if currently land
            if (data[idx] & IS_LAND) {
              data[idx] = 0x00; // Lake/Void: water, no ocean bit, magnitude 0
            }
          }
        }
      }
    }
  }

  // Fourth pass: add shoreline bits
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const isLand = Boolean(data[idx] & IS_LAND);

      // Check 4-connected neighbors for land/water boundary
      const neighbors = [
        y > 0 ? data[(y - 1) * width + x] : null,
        y < height - 1 ? data[(y + 1) * width + x] : null,
        x > 0 ? data[y * width + (x - 1)] : null,
        x < width - 1 ? data[y * width + (x + 1)] : null,
      ];

      let hasDifferentNeighbor = false;
      for (const n of neighbors) {
        if (n === null) continue;
        const nIsLand = Boolean(n & IS_LAND);
        if (nIsLand !== isLand) {
          hasDifferentNeighbor = true;
          break;
        }
      }

      if (hasDifferentNeighbor) {
        data[idx] |= SHORELINE;
      }
    }
  }

  // Ensure all nation coordinates are on land (plains at center)
  for (const nation of nations) {
    const [x, y] = nation.coordinates;
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = y * width + x;
      if (!(data[idx] & IS_LAND)) {
        // Force to plains
        data[idx] = plains(2);
      }
    }
  }

  // Count land tiles
  numLand = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] & IS_LAND) numLand++;
  }

  return { data, numLand };
}

/**
 * Downsample a terrain map by the given factor (2 for map4x, 4 for map16x).
 * Uses majority voting in each block.
 */
function downsample(srcData, srcWidth, srcHeight, factor) {
  const dstWidth = Math.floor(srcWidth / factor);
  const dstHeight = Math.floor(srcHeight / factor);
  const dst = new Uint8Array(dstWidth * dstHeight);
  let numLand = 0;

  for (let dy = 0; dy < dstHeight; dy++) {
    for (let dx = 0; dx < dstWidth; dx++) {
      let landCount = 0;
      let oceanCount = 0;
      let lakeCount = 0;
      let totalMag = 0;
      let totalShoreline = 0;
      const total = factor * factor;

      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const srcX = dx * factor + sx;
          const srcY = dy * factor + sy;
          const srcIdx = srcY * srcWidth + srcX;
          const b = srcData[srcIdx];
          const isLand = Boolean(b & IS_LAND);
          const isOcean = Boolean(b & OCEAN);
          const isShoreline = Boolean(b & SHORELINE);
          const mag = b & 0x1f;

          if (isLand) landCount++;
          else if (isOcean) oceanCount++;
          else lakeCount++;

          totalMag += mag;
          if (isShoreline) totalShoreline++;
        }
      }

      const avgMag = Math.round(totalMag / total);

      if (landCount >= total / 2) {
        // Majority land
        dst[dy * dstWidth + dx] = IS_LAND | (avgMag & 0x1f);
        numLand++;
      } else if (lakeCount > oceanCount) {
        dst[dy * dstWidth + dx] = avgMag & 0x1f; // Lake
      } else {
        dst[dy * dstWidth + dx] = OCEAN | (avgMag & 0x1f); // Ocean/deep space
      }

      if (totalShoreline > 0) {
        dst[dy * dstWidth + dx] |= SHORELINE;
      }
    }
  }

  return { data: dst, width: dstWidth, height: dstHeight, numLand };
}

// Map definitions
const maps = [
  {
    dir: "asteroidbelt",
    name: "Asteroid Belt",
    width: 800,
    height: 800,
    planetRadius: 80,
    nations: [
      { coordinates: [200, 200], flag: "", name: "Alpha Station" },
      { coordinates: [600, 200], flag: "", name: "Ceres Colony" },
      { coordinates: [400, 400], flag: "", name: "Vesta Outpost" },
      { coordinates: [150, 600], flag: "", name: "Pallas Base" },
      { coordinates: [650, 600], flag: "", name: "Hygiea Hub" },
      { coordinates: [400, 700], flag: "", name: "Juno Settlement" },
    ],
  },
  {
    dir: "solsystem",
    name: "Sol System",
    width: 1500,
    height: 1500,
    planetRadius: 120,
    nations: [
      { coordinates: [750, 750], flag: "", name: "Earth Alliance" },
      { coordinates: [400, 400], flag: "", name: "Venusian Republic" },
      { coordinates: [1100, 350], flag: "", name: "Jovian Federation" },
      { coordinates: [300, 1100], flag: "", name: "Saturn Ring States" },
      { coordinates: [1200, 1100], flag: "", name: "Uranus Collective" },
      { coordinates: [200, 250], flag: "", name: "Neptune Dominion" },
      { coordinates: [700, 1200], flag: "", name: "Mars Confederacy" },
      { coordinates: [1100, 700], flag: "", name: "Mercury Mining Corp" },
    ],
  },
  {
    dir: "orionsector",
    name: "Orion Sector",
    width: 3000,
    height: 2000,
    planetRadius: 150,
    nations: [
      { coordinates: [500, 400], flag: "", name: "Betelgeuse Empire" },
      { coordinates: [1500, 400], flag: "", name: "Rigel Consortium" },
      { coordinates: [2500, 400], flag: "", name: "Bellatrix Union" },
      { coordinates: [400, 1000], flag: "", name: "Saiph Republic" },
      { coordinates: [1200, 1000], flag: "", name: "Mintaka Alliance" },
      { coordinates: [2000, 1000], flag: "", name: "Alnilam Federation" },
      { coordinates: [2700, 1000], flag: "", name: "Alnitak Dominion" },
      { coordinates: [700, 1600], flag: "", name: "Meissa Collective" },
      { coordinates: [1700, 1600], flag: "", name: "Hatsya Station" },
      { coordinates: [2500, 1600], flag: "", name: "Tabit Outpost" },
    ],
  },
];

for (const mapDef of maps) {
  console.log(`\nGenerating ${mapDef.name} (${mapDef.width}x${mapDef.height})...`);

  const { data: mapData, numLand: mapLand } = generateMap(
    mapDef.width,
    mapDef.height,
    mapDef.nations,
    mapDef.planetRadius,
  );

  // Generate downscaled versions
  const map4x = downsample(mapData, mapDef.width, mapDef.height, 2);
  const map16x = downsample(mapData, mapDef.width, mapDef.height, 4);

  console.log(`  map.bin: ${mapDef.width}x${mapDef.height} = ${mapData.length} bytes, ${mapLand} land tiles`);
  console.log(`  map4x.bin: ${map4x.width}x${map4x.height} = ${map4x.data.length} bytes, ${map4x.numLand} land tiles`);
  console.log(`  map16x.bin: ${map16x.width}x${map16x.height} = ${map16x.data.length} bytes, ${map16x.numLand} land tiles`);

  // Verify nations are on land
  for (const nation of mapDef.nations) {
    const [x, y] = nation.coordinates;
    const idx = y * mapDef.width + x;
    const b = mapData[idx];
    const onLand = Boolean(b & IS_LAND);
    if (!onLand) {
      console.error(`  ERROR: ${nation.name} at (${x},${y}) is NOT on land! byte=0x${b.toString(16)}`);
      process.exit(1);
    }
  }
  console.log(`  All ${mapDef.nations.length} nations verified on land.`);

  // Write files
  const mapDir = path.join(MAPS_DIR, mapDef.dir);
  fs.mkdirSync(mapDir, { recursive: true });

  fs.writeFileSync(path.join(mapDir, "map.bin"), Buffer.from(mapData));
  fs.writeFileSync(path.join(mapDir, "map4x.bin"), Buffer.from(map4x.data));
  fs.writeFileSync(path.join(mapDir, "map16x.bin"), Buffer.from(map16x.data));

  // Write manifest
  const manifest = {
    name: mapDef.name,
    map: { width: mapDef.width, height: mapDef.height, num_land_tiles: mapLand },
    map4x: { width: map4x.width, height: map4x.height, num_land_tiles: map4x.numLand },
    map16x: { width: map16x.width, height: map16x.height, num_land_tiles: map16x.numLand },
    nations: mapDef.nations,
  };
  fs.writeFileSync(
    path.join(mapDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  // Keep existing thumbnail.webp (minimal valid file already exists)
  const thumbPath = path.join(mapDir, "thumbnail.webp");
  if (!fs.existsSync(thumbPath)) {
    // Create minimal RIFF/WEBP container (just needs to exist and be non-empty)
    const minimalWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // File size - 8
      0x57, 0x45, 0x42, 0x50, // "WEBP"
      0x56, 0x50, 0x38, 0x4C, // "VP8L"
      0x14, 0x00, 0x00, 0x00, // Chunk size
      0x2F, 0x00, 0x00, 0x00, // Signature
      0x00, 0x00, 0x00, 0x00, // Width/height
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    fs.writeFileSync(thumbPath, minimalWebp);
  }

  console.log(`  Written to ${mapDir}`);
}

console.log("\nDone! All space maps generated.");
