/**
 * Procedural Planet Texture Generator
 *
 * Generates per-planet 2D canvas textures applied to the sphere meshes in
 * PlanetLandmarks. Deterministic by seed — the same seed always produces the
 * same texture, so planets stay consistent across re-renders and rejoins.
 *
 * Design goals:
 *   1. LIGHTWEIGHT — a single shared 256×256 value-noise lookup table is
 *      generated once on first use; per-planet generation is ~2–4 ms for a
 *      256×128 canvas on modern hardware. No shaders, no worker, no network.
 *   2. VARIETY — six planet archetypes (Rocky, GasGiant, Ice, Lava, Ocean,
 *      Desert), each with their own palette family and feature modifiers
 *      (gas-giant bands, polar ice caps, lava glow).
 *   3. SEAMLESS — noise is sampled via a cylindrical mapping (cos/sin of the
 *      u angle) so u=0 and u=1 wrap without a visible seam on the rotating
 *      sphere.
 *   4. OWNERSHIP FRIENDLY — the texture defines the planet's *identity*; the
 *      caller is expected to tint ownership via the material's `emissive`
 *      channel rather than `color`, so the procedural pattern stays visible
 *      regardless of which player owns the planet.
 *
 * Usage:
 *   const seed = hashString(nation.name) ^ (coordX * 73856093) ^ (coordY * 19349663);
 *   const texture = getPlanetTexture(seed);
 *   <meshStandardMaterial map={texture} color="white" ... />
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Output canvas dimensions. 256×128 keeps texture POT for WebGL 1 safety
 *  and still generates in ~2–4 ms per planet. */
const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 128;

/** Shared value-noise lookup table size (square). 256 gives enough variation
 *  that no repetition is visible at planet rendering scales. */
const NOISE_TABLE_SIZE = 256;

/** Number of FBM octaves. 4 is a good balance — 5 adds ~25% cost for only
 *  marginally more visible detail at the final texture resolution. */
const FBM_OCTAVES = 4;

// ─── Deterministic PRNG ─────────────────────────────────────────────────────

/** mulberry32 — fast 32-bit deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → 32-bit unsigned int. Exported so callers can derive
 *  stable seeds from nation names / ids without re-implementing it. */
export function hashString(s: string): number {
  let h = 2166136261 | 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─── Shared value-noise lookup table ────────────────────────────────────────

let noiseTable: Float32Array | null = null;

function getNoiseTable(): Float32Array {
  if (noiseTable !== null) return noiseTable;
  // Fixed seed so every client builds the same base table. Per-planet
  // variation comes from per-planet offsets into this table, not from a
  // different table per planet — that keeps generation cheap.
  const rand = mulberry32(0xb16b00b5);
  const table = new Float32Array(NOISE_TABLE_SIZE * NOISE_TABLE_SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  noiseTable = table;
  return table;
}

function tableLookup(x: number, y: number): number {
  const table = getNoiseTable();
  const ix =
    (((x | 0) % NOISE_TABLE_SIZE) + NOISE_TABLE_SIZE) % NOISE_TABLE_SIZE;
  const iy =
    (((y | 0) % NOISE_TABLE_SIZE) + NOISE_TABLE_SIZE) % NOISE_TABLE_SIZE;
  return table[iy * NOISE_TABLE_SIZE + ix];
}

/** Bilinear-interpolated value noise with smoothstep fade. */
function noise2D(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = x - x0;
  const sy = y - y0;
  const a = tableLookup(x0, y0);
  const b = tableLookup(x0 + 1, y0);
  const c = tableLookup(x0, y0 + 1);
  const d = tableLookup(x0 + 1, y0 + 1);
  const ux = sx * sx * (3 - 2 * sx);
  const uy = sy * sy * (3 - 2 * sy);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

/** Fractional Brownian motion — sum of octaves of value noise with decaying
 *  amplitude. Output is roughly normalised to [0, 1]. */
function fbm(
  x: number,
  y: number,
  octaves: number,
  offsetX: number,
  offsetY: number,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq + offsetX, y * freq + offsetY);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ─── Planet archetypes ──────────────────────────────────────────────────────

enum Archetype {
  Rocky,
  GasGiant,
  Ice,
  Lava,
  Ocean,
  Desert,
}

type RGB = [number, number, number];

interface Palette {
  /** Deep / shadow colour (valleys, oceans, shadowed bands). */
  low: RGB;
  /** Dominant surface tone. */
  base: RGB;
  /** Highlight / peak colour. */
  high: RGB;
  /** Optional hot-spot colour used for lava glow pass. */
  glow?: RGB;
}

const PALETTES: Record<Archetype, Palette[]> = {
  [Archetype.Rocky]: [
    { low: [55, 35, 25], base: [115, 80, 55], high: [180, 145, 105] },
    { low: [40, 30, 25], base: [95, 80, 70], high: [165, 145, 125] },
    { low: [60, 40, 20], base: [140, 90, 45], high: [210, 160, 110] },
    { low: [45, 40, 50], base: [95, 90, 110], high: [165, 160, 180] },
  ],
  [Archetype.GasGiant]: [
    { low: [120, 80, 50], base: [180, 140, 90], high: [235, 205, 150] },
    { low: [50, 80, 120], base: [90, 135, 180], high: [160, 205, 240] },
    { low: [80, 50, 100], base: [150, 100, 170], high: [220, 180, 240] },
    { low: [100, 60, 50], base: [180, 110, 80], high: [240, 180, 140] },
    { low: [40, 70, 60], base: [80, 130, 110], high: [160, 210, 180] },
  ],
  [Archetype.Ice]: [
    { low: [100, 140, 180], base: [180, 210, 240], high: [245, 250, 255] },
    { low: [80, 110, 140], base: [150, 180, 210], high: [230, 240, 250] },
    { low: [120, 150, 160], base: [190, 220, 225], high: [245, 250, 255] },
  ],
  [Archetype.Lava]: [
    {
      low: [20, 10, 5],
      base: [60, 25, 15],
      high: [120, 50, 25],
      glow: [255, 180, 60],
    },
    {
      low: [15, 8, 8],
      base: [50, 20, 20],
      high: [110, 45, 35],
      glow: [255, 140, 40],
    },
  ],
  [Archetype.Ocean]: [
    { low: [20, 50, 100], base: [40, 95, 150], high: [90, 160, 95] },
    { low: [15, 40, 80], base: [30, 80, 130], high: [200, 190, 150] },
    { low: [25, 60, 90], base: [50, 110, 140], high: [150, 185, 130] },
  ],
  [Archetype.Desert]: [
    { low: [140, 90, 50], base: [200, 160, 100], high: [240, 215, 170] },
    { low: [120, 60, 30], base: [180, 120, 70], high: [230, 190, 140] },
    { low: [150, 100, 80], base: [210, 170, 130], high: [245, 225, 190] },
  ],
};

/** Archetype selection weights. Sum should equal 1. */
const ARCHETYPE_WEIGHTS: Array<[Archetype, number]> = [
  [Archetype.Rocky, 0.22],
  [Archetype.GasGiant, 0.2],
  [Archetype.Ice, 0.14],
  [Archetype.Lava, 0.12],
  [Archetype.Ocean, 0.16],
  [Archetype.Desert, 0.16],
];

function pickArchetype(rand: () => number): Archetype {
  const r = rand();
  let acc = 0;
  for (const [arch, w] of ARCHETYPE_WEIGHTS) {
    acc += w;
    if (r < acc) return arch;
  }
  return Archetype.Rocky;
}

// ─── Colour helpers ─────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/** 3-stop gradient lookup: low → base → high, with a flat plateau at the top.
 *  Palette authors put the "average" tone at base and extremes at low/high. */
function sampleGradient(palette: Palette, t: number): RGB {
  if (t < 0.45) return mix(palette.low, palette.base, t / 0.45);
  if (t < 0.8) return mix(palette.base, palette.high, (t - 0.45) / 0.35);
  return palette.high;
}

// ─── Texture cache ──────────────────────────────────────────────────────────

const textureCache = new Map<number, CanvasTexture>();

/** Fetch or lazily generate a planet texture for the given seed. */
export function getPlanetTexture(seed: number): CanvasTexture {
  const existing = textureCache.get(seed);
  if (existing !== undefined) return existing;
  const texture = generatePlanetTexture(seed);
  textureCache.set(seed, texture);
  return texture;
}

/** Dispose every cached texture. Call on full scene teardown. */
export function disposePlanetTextures(): void {
  textureCache.forEach((tex) => tex.dispose());
  textureCache.clear();
}

// ─── Core generator ─────────────────────────────────────────────────────────

function generatePlanetTexture(seed: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("PlanetTextureGenerator: canvas 2D context unavailable");
  }
  const imageData = ctx.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  const data = imageData.data;

  const rand = mulberry32(seed);
  const archetype = pickArchetype(rand);
  const palettes = PALETTES[archetype];
  const palette = palettes[Math.floor(rand() * palettes.length)];

  // Per-planet parameters driven by the seeded PRNG. Offset and scale vary
  // which slice of the shared noise table this planet samples, so two
  // planets with the same archetype still look distinct.
  const offsetX = rand() * 1000;
  const offsetY = rand() * 1000;
  const noiseScale = 3 + rand() * 4; // 3..7
  const contrast = 1.15 + rand() * 0.25; // 1.15..1.4

  // Gas-giant horizontal bands
  const bandStrength = archetype === Archetype.GasGiant ? 0.75 : 0;
  const bandCount = 4 + Math.floor(rand() * 6); // 4..9
  const bandJitter = 0.25 + rand() * 0.5; // 0.25..0.75

  // Polar ice caps (only on terrestrial-ish archetypes)
  const hasPoleCaps =
    archetype === Archetype.Rocky ||
    archetype === Archetype.Ocean ||
    archetype === Archetype.Ice;
  const poleCapSize = 0.1 + rand() * 0.12; // 0.1..0.22 of latitude extent

  // Lava glow pass — bright hot spots in low-noise valleys
  const hasLavaGlow =
    archetype === Archetype.Lava && palette.glow !== undefined;

  for (let y = 0; y < TEXTURE_HEIGHT; y++) {
    const v = y / TEXTURE_HEIGHT;
    const lat = v * 2 - 1; // -1 = south pole, 0 = equator, 1 = north pole

    for (let x = 0; x < TEXTURE_WIDTH; x++) {
      const u = x / TEXTURE_WIDTH;

      // Cylindrical mapping: sample noise using (cos(u), sin(u)) so the
      // horizontal axis is continuous across the u=0/u=1 seam. Mixing two
      // decorrelated samples gives 2D-like detail while staying seamless.
      const angle = u * Math.PI * 2;
      const cx = Math.cos(angle) * noiseScale;
      const cz = Math.sin(angle) * noiseScale;
      const cy = v * noiseScale * 2;
      const n =
        0.5 * fbm(cx, cy, FBM_OCTAVES, offsetX, offsetY) +
        0.5 * fbm(cz, cy + 37, FBM_OCTAVES, offsetX + 13, offsetY + 23);

      // Gentle contrast bump so mid-tones don't mush together.
      let t = 0.5 + (n - 0.5) * contrast;

      if (bandStrength > 0) {
        // Gas-giant bands: sinusoidal in latitude, modulated by noise for
        // organic streaks rather than flat stripes.
        const band =
          0.5 +
          0.5 * Math.sin(lat * Math.PI * bandCount + n * bandJitter * Math.PI);
        t = lerp(t, band, bandStrength);
      }

      t = Math.max(0, Math.min(1, t));

      let color = sampleGradient(palette, t);

      if (hasLavaGlow && palette.glow !== undefined && n < 0.35) {
        const glowT = (0.35 - n) / 0.35;
        color = mix(color, palette.glow, glowT * 0.85);
      }

      if (hasPoleCaps) {
        const poleDist = Math.abs(lat);
        const capStart = 1 - poleCapSize;
        if (poleDist > capStart) {
          const capT = (poleDist - capStart) / poleCapSize;
          // Noisy cap boundary → organic frontier instead of a hard band.
          const edge = capT - 0.25 * (n - 0.5);
          if (edge > 0) {
            color = mix(color, [240, 245, 250], Math.min(1, edge * 1.6));
          }
        }
      }

      const idx = (y * TEXTURE_WIDTH + x) * 4;
      data[idx] = color[0] | 0;
      data[idx + 1] = color[1] | 0;
      data[idx + 2] = color[2] | 0;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
