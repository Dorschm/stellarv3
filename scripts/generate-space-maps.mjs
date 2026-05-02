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
 * Deterministic per-planet PRNG. Seeded from the planet's coordinates so
 * regenerating the map produces the same terrain (the binary outputs are
 * checked into the repo), but each planet on a map gets its own stream so
 * shape, banding, and pocket layout vary independently.
 *
 * Uses Mulberry32 — small, fast, well-distributed for our use, no deps.
 */
function planetSeed(cx, cy) {
  // Mix the two coordinates with two large odd primes so adjacent planets
  // produce very different seeds rather than near-identical streams.
  return (Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663)) >>> 0;
}
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a terrain map with planetary zones.
 *
 * Each planet is drawn with seeded variance: its effective radius, outline
 * shape (sinusoidal angular wobble), inner/middle/outer band thresholds,
 * mountain scatter pattern, and void-pocket layout all derive from a
 * per-planet PRNG. Players can no longer memorize a single "best spawn
 * radius" because each map's planets carry distinct shapes and band sizes
 * while still respecting the canonical inner-plains / middle-highland /
 * outer-mountain / edge-plains rule.
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

  // Second pass: draw planetary blobs for each nation
  for (const nation of nations) {
    const [cx, cy] = nation.coordinates;
    const rng = makeRng(planetSeed(cx, cy));

    // Effective radius varies ±15% from the map's base radius. The bounding
    // box still reserves room for the maximum (1.15 + max wobble) so we
    // never clip a planet whose noise pushes its outline outward.
    const radiusMul = 0.85 + rng() * 0.3;
    const baseR = planetRadius * radiusMul;

    // Angular outline noise — two sinusoids of different frequencies
    // combined to give an organic, non-circular blob. Amplitudes stay below
    // the safety margin used for the bounding box so the iterated tile
    // window always covers any extruded section of the planet.
    const lobesA = 3 + Math.floor(rng() * 4); // 3-6 lobes
    const lobesB = 5 + Math.floor(rng() * 6); // 5-10 lobes
    const phaseA = rng() * Math.PI * 2;
    const phaseB = rng() * Math.PI * 2;
    const ampA = 0.06 + rng() * 0.07; // 6-13% wobble
    const ampB = 0.03 + rng() * 0.05; // 3-8% wobble
    const localR = (angle) =>
      baseR *
      (1 +
        ampA * Math.sin(angle * lobesA + phaseA) +
        ampB * Math.sin(angle * lobesB + phaseB));

    // Per-planet band thresholds. Each band's edge is a normalized fraction
    // of `localR(angle)`, so the same rule (plains < highland < mountain)
    // holds even though the absolute pixel widths differ between planets.
    const innerEdge = 0.48 + rng() * 0.14; // 0.48-0.62
    const middleEdge = innerEdge + 0.18 + rng() * 0.1; // ~0.66-0.90
    const outerEdge = Math.min(0.96, middleEdge + 0.05 + rng() * 0.06);

    // Mountain scatter density and seed for the per-tile hash. Different
    // density per planet means some have rocky rims and others mostly clear
    // outer edges.
    const mountainDensity = 25 + Math.floor(rng() * 35); // 25-59 % of outer ring
    const mountainSeedA = 1 + Math.floor(rng() * 65535);
    const mountainSeedB = 1 + Math.floor(rng() * 65535);

    // Bounding-box safety: enclose the maximum possible outline plus 2px of
    // anti-clipping margin.
    const maxR = baseR * (1 + ampA + ampB) + 2;
    const xMin = Math.max(0, Math.floor(cx - maxR));
    const xMax = Math.min(width - 1, Math.ceil(cx + maxR));
    const yMin = Math.max(0, Math.floor(cy - maxR));
    const yMax = Math.min(height - 1, Math.ceil(cy + maxR));

    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx === 0 && dy === 0) {
          // Exact center is forced to plains by the safety pass below; skip
          // expensive band math here.
          data[y * width + x] = plains(0);
          continue;
        }
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const r = localR(angle);
        const normDist = dist / r;

        if (normDist <= 1.0) {
          const idx = y * width + x;

          if (normDist < innerEdge) {
            // Inner zone: plains. Scale magnitude across the inner band so
            // the edge of plains still rises gently into the highland step.
            const mag = Math.floor((normDist / innerEdge) * 9);
            data[idx] = plains(Math.min(mag, 9));
          } else if (normDist < middleEdge) {
            // Middle ring: highland. Magnitude 10-18 spread across the ring.
            const span = middleEdge - innerEdge;
            const mag = 10 + Math.floor(((normDist - innerEdge) / span) * 9);
            data[idx] = highland(Math.min(mag, 18));
          } else if (normDist < outerEdge) {
            // Outer ring: mountain peaks scattered over highland filler.
            // Hash mixes per-tile coordinates with the per-planet seeds so
            // the speckle pattern differs across planets.
            const hash =
              (((x * mountainSeedA + y * mountainSeedB) % 100) + 100) % 100;
            const span = outerEdge - middleEdge;
            if (hash < mountainDensity) {
              const mag = 20 + Math.floor(((normDist - middleEdge) / span) * 5);
              data[idx] = mountain(Math.min(mag, 25));
            } else {
              const mag = 15 + Math.floor(((normDist - middleEdge) / span) * 4);
              data[idx] = highland(Math.min(mag, 19));
            }
          } else {
            // Edge: plains feathering back into deep space. Drop to mag 0
            // exactly at the outline so the SHORELINE pass picks this rim
            // up cleanly.
            const span = 1.0 - outerEdge;
            const mag = Math.max(
              0,
              Math.floor((1.0 - normDist) * (9 / Math.max(span, 0.01))),
            );
            data[idx] = plains(Math.min(mag, 9));
          }
        }
      }
    }
  }

  // Third pass: add void pockets (lakes) scattered on planets. Per-planet
  // PRNG drives count, position, and size so two identical-looking planets
  // will still play differently around their pocket layout.
  for (const nation of nations) {
    const [cx, cy] = nation.coordinates;
    // Re-derive the planet's PRNG. We deliberately don't reuse the loop
    // variable from the band pass so future refactors that split the
    // generator into per-planet chunks stay correct.
    const rng = makeRng(planetSeed(cx, cy) ^ 0xa5a5a5a5);
    const r = planetRadius;
    const numVoids = 1 + Math.floor(rng() * 5); // 1-5 pockets
    for (let v = 0; v < numVoids; v++) {
      const angle = rng() * Math.PI * 2;
      const voidDist = r * (0.2 + rng() * 0.55); // 20-75% out from center
      const vx = Math.round(cx + Math.cos(angle) * voidDist);
      const vy = Math.round(cy + Math.sin(angle) * voidDist);
      // Pocket radius: 3-9% of planet radius, minimum 2 tiles.
      const voidR = Math.max(2, Math.floor(r * (0.03 + rng() * 0.06)));

      for (
        let y = Math.max(0, vy - voidR);
        y <= Math.min(height - 1, vy + voidR);
        y++
      ) {
        for (
          let x = Math.max(0, vx - voidR);
          x <= Math.min(width - 1, vx + voidR);
          x++
        ) {
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
  console.log(
    `\nGenerating ${mapDef.name} (${mapDef.width}x${mapDef.height})...`,
  );

  const { data: mapData, numLand: mapLand } = generateMap(
    mapDef.width,
    mapDef.height,
    mapDef.nations,
    mapDef.planetRadius,
  );

  // Generate downscaled versions
  const map4x = downsample(mapData, mapDef.width, mapDef.height, 2);
  const map16x = downsample(mapData, mapDef.width, mapDef.height, 4);

  console.log(
    `  map.bin: ${mapDef.width}x${mapDef.height} = ${mapData.length} bytes, ${mapLand} land tiles`,
  );
  console.log(
    `  map4x.bin: ${map4x.width}x${map4x.height} = ${map4x.data.length} bytes, ${map4x.numLand} land tiles`,
  );
  console.log(
    `  map16x.bin: ${map16x.width}x${map16x.height} = ${map16x.data.length} bytes, ${map16x.numLand} land tiles`,
  );

  // Verify nations are on land
  for (const nation of mapDef.nations) {
    const [x, y] = nation.coordinates;
    const idx = y * mapDef.width + x;
    const b = mapData[idx];
    const onLand = Boolean(b & IS_LAND);
    if (!onLand) {
      console.error(
        `  ERROR: ${nation.name} at (${x},${y}) is NOT on land! byte=0x${b.toString(16)}`,
      );
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
    map: {
      width: mapDef.width,
      height: mapDef.height,
      num_land_tiles: mapLand,
    },
    map4x: {
      width: map4x.width,
      height: map4x.height,
      num_land_tiles: map4x.numLand,
    },
    map16x: {
      width: map16x.width,
      height: map16x.height,
      num_land_tiles: map16x.numLand,
    },
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
      0x52,
      0x49,
      0x46,
      0x46, // "RIFF"
      0x24,
      0x00,
      0x00,
      0x00, // File size - 8
      0x57,
      0x45,
      0x42,
      0x50, // "WEBP"
      0x56,
      0x50,
      0x38,
      0x4c, // "VP8L"
      0x14,
      0x00,
      0x00,
      0x00, // Chunk size
      0x2f,
      0x00,
      0x00,
      0x00, // Signature
      0x00,
      0x00,
      0x00,
      0x00, // Width/height
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    fs.writeFileSync(thumbPath, minimalWebp);
  }

  console.log(`  Written to ${mapDir}`);
}

console.log("\nDone! All space maps generated.");
