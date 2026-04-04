import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  DataTexture,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from "three";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useGameView } from "../bridge/GameViewContext";
import { TileRef } from "../../core/game/GameMap";
import { TerrainType } from "../../core/game/Game";
import { UserSettings } from "../../core/game/UserSettings";
import {
  MouseUpEvent,
  ContextMenuEvent,
  MouseDownEvent,
  AutoUpgradeEvent,
  TileHoverEvent,
} from "../InputHandler";

// ─── Space-themed terrain palette ────────────────────────────────────────────
// Ocean  → deep space (very dark blues / near-black)
// Shore  → nebula fringe (muted purple-blue)
// Plains → habitable sector (teal / cyan glow)
// Highland → dense nebula (warm amber / orange)
// Mountain → asteroid field (bright white / silver)

interface SpaceColor {
  r: number;
  g: number;
  b: number;
}

function spaceTerrainColor(
  terrainType: TerrainType,
  magnitude: number,
  isShore: boolean,
  isShoreline: boolean,
  isWater: boolean,
): SpaceColor {
  if (isShore) {
    // Nebula fringe – muted violet
    return { r: 80, g: 60, b: 120 };
  }

  switch (terrainType) {
    case TerrainType.Ocean:
    case TerrainType.Lake: {
      if (isShoreline && isWater) {
        // Shallow space – slightly lighter
        return { r: 12, g: 10, b: 35 };
      }
      // Deep space – gets darker with distance from land
      const fade = Math.min(magnitude, 10);
      return {
        r: Math.max(5, 15 - fade),
        g: Math.max(3, 12 - fade),
        b: Math.max(15, 30 - fade),
      };
    }
    case TerrainType.Plains: {
      // Habitable sector – teal / cyan glow, slight variation with magnitude
      const m = Math.min(magnitude, 9);
      return {
        r: 30 + m * 2,
        g: 90 + m * 3,
        b: 100 + m * 2,
      };
    }
    case TerrainType.Highland: {
      // Dense nebula – warm amber / orange tones
      const m = Math.min(magnitude, 19);
      return {
        r: 120 + m * 2,
        g: 80 + m,
        b: 50 + m,
      };
    }
    case TerrainType.Mountain: {
      // Asteroid field – bright silver / white
      const m = Math.min(magnitude, 30);
      return {
        r: 180 + Math.floor(m / 2),
        g: 180 + Math.floor(m / 2),
        b: 190 + Math.floor(m / 2),
      };
    }
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max DataTexture dimension to stay within the GPU budget (spec §1.1). */
const MAX_TEXTURE_DIM = 4096;

/** Territory overlay alpha (0-255). */
const TERRITORY_ALPHA = 160;

/** Fallout overlay colour (radioactive green, matching PastelTheme fallout). */
const FALLOUT_COLOR = { r: 120, g: 255, b: 71 };
/** Fallout overlay alpha (0-255). */
const FALLOUT_ALPHA = 150;

const userSettings = new UserSettings();

/**
 * SpaceMapPlane – renders the game map as a DataTexture-backed PlaneGeometry.
 *
 * Terrain is drawn once; territory ownership colours are updated every tick
 * via `game.recentlyUpdatedTiles()`.
 *
 * Pointer events on the mesh are converted from UV coordinates to tile
 * coordinates and emitted on the EventBus as MouseUpEvent / ContextMenuEvent.
 */
export function SpaceMapPlane(): React.JSX.Element | null {
  const { gameView: game, eventBus } = useGameView();

  // ── Dimensions (clamped to 4096) ────────────────────────────────────────
  const mapWidth = game.width();
  const mapHeight = game.height();
  const texWidth = Math.min(mapWidth, MAX_TEXTURE_DIM);
  const texHeight = Math.min(mapHeight, MAX_TEXTURE_DIM);

  // ── Refs for mutable texture data ───────────────────────────────────────
  const terrainBufRef = useRef<Uint8ClampedArray | null>(null);
  const territoryBufRef = useRef<Uint8ClampedArray | null>(null);
  const compositeBufRef = useRef<Uint8ClampedArray | null>(null);
  const textureRef = useRef<DataTexture | null>(null);

  // Track pointer-down position for click-vs-drag detection
  const pointerDownRef = useRef<{
    x: number;
    y: number;
    button: number;
  } | null>(null);

  // ── Initialise pixel buffers and terrain ────────────────────────────────
  useEffect(() => {
    const numPixels = texWidth * texHeight;
    const terrain = new Uint8ClampedArray(numPixels * 4);
    const territory = new Uint8ClampedArray(numPixels * 4); // RGBA, starts transparent
    const composite = new Uint8ClampedArray(numPixels * 4);

    // Paint terrain
    game.forEachTile((tile: TileRef) => {
      const tx = game.x(tile);
      const ty = game.y(tile);
      if (tx >= texWidth || ty >= texHeight) return;

      const idx = (ty * texWidth + tx) * 4;
      const color = spaceTerrainColor(
        game.terrainType(tile),
        game.magnitude(tile),
        game.isShore(tile),
        game.isShoreline(tile),
        game.isWater(tile),
      );
      terrain[idx] = color.r;
      terrain[idx + 1] = color.g;
      terrain[idx + 2] = color.b;
      terrain[idx + 3] = 255;
    });

    terrainBufRef.current = terrain;
    territoryBufRef.current = territory;
    compositeBufRef.current = composite;

    // Also paint initial territory for all owned tiles and fallout
    game.forEachTile((tile: TileRef) => {
      const tx = game.x(tile);
      const ty = game.y(tile);
      if (tx >= texWidth || ty >= texHeight) return;
      const idx = (ty * texWidth + tx) * 4;

      const owner = game.owner(tile);
      if (owner.isPlayer()) {
        const c = owner.territoryColor(tile).rgba;
        territory[idx] = c.r;
        territory[idx + 1] = c.g;
        territory[idx + 2] = c.b;
        territory[idx + 3] = TERRITORY_ALPHA;
      } else if (game.hasFallout(tile)) {
        territory[idx] = FALLOUT_COLOR.r;
        territory[idx + 1] = FALLOUT_COLOR.g;
        territory[idx + 2] = FALLOUT_COLOR.b;
        territory[idx + 3] = FALLOUT_ALPHA;
      }
    });

    // Build composite
    compositeBuffers(terrain, territory, composite);

    // Create DataTexture backed directly by the composite buffer
    const data = new Uint8Array(composite.buffer, composite.byteOffset, composite.byteLength);
    const tex = new DataTexture(data, texWidth, texHeight, RGBAFormat, UnsignedByteType);
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    textureRef.current = tex;

    return () => {
      tex.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, texWidth, texHeight]);

  // ── Per-frame territory update (~render loop) ───────────────────────────
  useFrame(() => {
    const territory = territoryBufRef.current;
    const terrain = terrainBufRef.current;
    const composite = compositeBufRef.current;
    const tex = textureRef.current;
    if (!territory || !terrain || !composite || !tex) return;

    const updated = game.recentlyUpdatedTiles();
    if (updated.length === 0) return;

    // Update territory buffer for changed tiles
    for (const tile of updated) {
      const tx = game.x(tile);
      const ty = game.y(tile);
      if (tx >= texWidth || ty >= texHeight) continue;
      const idx = (ty * texWidth + tx) * 4;

      const owner = game.owner(tile);
      if (owner.isPlayer()) {
        const c = owner.territoryColor(tile).rgba;
        territory[idx] = c.r;
        territory[idx + 1] = c.g;
        territory[idx + 2] = c.b;
        territory[idx + 3] = TERRITORY_ALPHA;
      } else if (game.hasFallout(tile)) {
        // Fallout – radioactive green glow overlay
        territory[idx] = FALLOUT_COLOR.r;
        territory[idx + 1] = FALLOUT_COLOR.g;
        territory[idx + 2] = FALLOUT_COLOR.b;
        territory[idx + 3] = FALLOUT_ALPHA;
      } else {
        // Unowned – clear territory
        territory[idx + 3] = 0;
      }
    }

    // Re-composite only changed tiles (fast path)
    for (const tile of updated) {
      const tx = game.x(tile);
      const ty = game.y(tile);
      if (tx >= texWidth || ty >= texHeight) continue;
      const idx = (ty * texWidth + tx) * 4;
      compositePixel(terrain, territory, composite, idx);
    }

    // Signal GPU upload — DataTexture reads directly from the composite buffer
    tex.needsUpdate = true;
  });

  // ── Pointer → tile coordinate conversion ────────────────────────────────
  const uvToTile = useCallback(
    (uv: { x: number; y: number }): { tileX: number; tileY: number } => {
      const tileX = Math.floor(uv.x * mapWidth);
      const tileY = Math.floor((1 - uv.y) * mapHeight);
      return {
        tileX: Math.max(0, Math.min(mapWidth - 1, tileX)),
        tileY: Math.max(0, Math.min(mapHeight - 1, tileY)),
      };
    },
    [mapWidth, mapHeight],
  );

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      pointerDownRef.current = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
      };

      if (e.uv) {
        const { tileX, tileY } = uvToTile(e.uv);
        if (e.button === 0) {
          eventBus.emit(new MouseDownEvent(tileX, tileY));
        } else if (e.button === 1) {
          // Middle-click → auto-upgrade nearest structure
          e.nativeEvent.preventDefault();
          eventBus.emit(new AutoUpgradeEvent(tileX, tileY));
        }
      }
    },
    [eventBus, uvToTile],
  );

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!e.uv || !pointerDownRef.current) return;

      // Click-vs-drag threshold (same 10px as InputHandler)
      const dist =
        Math.abs(e.clientX - pointerDownRef.current.x) +
        Math.abs(e.clientY - pointerDownRef.current.y);
      const button = pointerDownRef.current.button;
      pointerDownRef.current = null;

      if (dist >= 10) return; // was a drag, not a click

      if (button === 0) {
        const { tileX, tileY } = uvToTile(e.uv);
        // Honour leftClickOpensMenu user setting
        if (userSettings.leftClickOpensMenu() && !e.nativeEvent.shiftKey) {
          eventBus.emit(new ContextMenuEvent(tileX, tileY, true));
        } else {
          eventBus.emit(new MouseUpEvent(tileX, tileY, true));
        }
      }
      // Right-click (button === 2) is handled exclusively by onContextMenu
    },
    [eventBus, uvToTile],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!e.uv) return;
      const { tileX, tileY } = uvToTile(e.uv);
      eventBus.emit(new TileHoverEvent(tileX, tileY));
    },
    [eventBus, uvToTile],
  );

  const onContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.nativeEvent.preventDefault();
      e.stopPropagation();
      if (!e.uv) return;

      const { tileX, tileY } = uvToTile(e.uv);
      eventBus.emit(new ContextMenuEvent(tileX, tileY, true));
    },
    [eventBus, uvToTile],
  );

  // ── Geometry (plane sized to map) ───────────────────────────────────────
  const geometry = useMemo(
    () => new PlaneGeometry(mapWidth, mapHeight),
    [mapWidth, mapHeight],
  );

  if (!textureRef.current) return null;

  return (
    <mesh
      geometry={geometry}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onContextMenu={onContextMenu}
    >
      <meshBasicMaterial map={textureRef.current} />
    </mesh>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Alpha-composite territory over terrain for the full buffer. */
function compositeBuffers(
  terrain: Uint8ClampedArray,
  territory: Uint8ClampedArray,
  out: Uint8ClampedArray,
): void {
  for (let i = 0; i < terrain.length; i += 4) {
    compositePixel(terrain, territory, out, i);
  }
}

/** Alpha-composite a single pixel at offset `i`. */
function compositePixel(
  terrain: Uint8ClampedArray,
  territory: Uint8ClampedArray,
  out: Uint8ClampedArray,
  i: number,
): void {
  const tAlpha = territory[i + 3];
  if (tAlpha === 0) {
    // No territory – straight terrain
    out[i] = terrain[i];
    out[i + 1] = terrain[i + 1];
    out[i + 2] = terrain[i + 2];
    out[i + 3] = terrain[i + 3];
  } else {
    // Alpha blend: territory over terrain
    const a = tAlpha / 255;
    const inv = 1 - a;
    out[i] = Math.round(territory[i] * a + terrain[i] * inv);
    out[i + 1] = Math.round(territory[i + 1] * a + terrain[i + 1] * inv);
    out[i + 2] = Math.round(territory[i + 2] * a + terrain[i + 2] * inv);
    out[i + 3] = 255;
  }
}
