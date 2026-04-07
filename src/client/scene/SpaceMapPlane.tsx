import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DragEvent,
  TileHoverEvent,
  TileHoverClearEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
  SceneTickEvent,
  GhostStructureChangedEvent,
} from "../InputHandler";
import { useHUDStore } from "../bridge/HUDStore";
import {
  isAltKeyPressed,
  isModifierKeyPressed,
  loadKeybinds,
} from "../bridge/keybindModifiers";

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
    // Planetary zone perimeter – subtle brightness to define planet boundary
    return { r: 95, g: 75, b: 140 };
  }

  switch (terrainType) {
    case TerrainType.Ocean:
    case TerrainType.Lake: {
      if (isShoreline && isWater) {
        // Shoreline water near habitable zones – faint glow
        return { r: 6, g: 5, b: 18 };
      }
      // Deep space – near-black void so planetary zones pop
      return { r: 2, g: 2, b: 5 };
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

  // Load configured keybinds once per mount so modifier-click shortcuts
  // (build / emoji menus) honour the user's custom modifierKey / altKey
  // bindings instead of the hardcoded ctrl+meta / alt pair.
  const keybinds = useMemo(() => loadKeybinds(), []);

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
  // Dirty tiles accumulated from SceneTickEvent handlers between frames.
  // Each tick's changed tiles are pushed here synchronously in the event
  // handler; useFrame drains the list and flushes to the texture.
  const pendingDirtyTilesRef = useRef<TileRef[]>([]);

  // The texture is created inside useEffect (post-render). Refs alone don't
  // trigger re-renders, so without this state flag the component would
  // return null on first render and never re-render to display the mesh.
  const [textureReady, setTextureReady] = useState(false);

  // Track pointer-down position for click-vs-drag detection and
  // incremental drag deltas (lastMoveX/Y advance with each pointermove so
  // we can emit DragEvents that pan the camera while the left button is held).
  const pointerDownRef = useRef<{
    x: number;
    y: number;
    button: number;
    lastMoveX: number;
    lastMoveY: number;
    dragging: boolean;
  } | null>(null);

  // Cleanup function for the temporary window-level pointermove handler
  // installed when the pointer leaves the mesh mid-drag. Keeping drags
  // alive outside the mesh mirrors legacy InputHandler behaviour where
  // window-level pointermove continued panning until pointerup.
  const windowDragCleanupRef = useRef<(() => void) | null>(null);

  // ── Initialise pixel buffers and terrain ────────────────────────────────
  useEffect(() => {
    // Guardrail (spec §1.1): authored space maps must stay within the
    // MAX_TEXTURE_DIM budget. If a map exceeds the limit, the DataTexture
    // gets clamped but the UV→tile mapping still covers the full map range,
    // so territory colours for tiles beyond the limit are silently dropped.
    // Surface this loudly during development instead of degrading quietly.
    if (mapWidth > MAX_TEXTURE_DIM || mapHeight > MAX_TEXTURE_DIM) {
      console.warn(
        `SpaceMapPlane: map dimensions (${mapWidth}x${mapHeight}) exceed ` +
          `MAX_TEXTURE_DIM (${MAX_TEXTURE_DIM}). Tiles beyond the texture ` +
          `budget will not render correctly. See spec §1.1.`,
      );
    }

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
    tex.flipY = true;
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    textureRef.current = tex;

    // Initial paint has already composited every tile and any already-owned
    // territory. Discard any dirty tiles that accumulated before the texture
    // was ready so they aren't redundantly reapplied on the first frame.
    pendingDirtyTilesRef.current = [];

    // Trigger a React re-render so the mesh JSX picks up the new texture.
    setTextureReady(true);

    return () => {
      tex.dispose();
      setTextureReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, texWidth, texHeight]);

  // ── Accumulate dirty tiles from every game tick ─────────────────────────
  // SceneTickEvent fires synchronously after GameView.update() for each
  // tick. At that moment game.recentlyUpdatedTiles() holds exactly that
  // tick's changed tiles. Pushing them into pendingDirtyTilesRef ensures
  // no intermediate batch is lost when multiple ticks land between frames
  // (reconnect catch-up, replay fast-forward, low-FPS spikes).
  useEffect(() => {
    const handler = () => {
      const tiles = game.recentlyUpdatedTiles();
      if (tiles.length > 0) {
        const pending = pendingDirtyTilesRef.current;
        for (const tile of tiles) {
          pending.push(tile);
        }
      }
    };
    eventBus.on(SceneTickEvent, handler);
    return () => {
      eventBus.off(SceneTickEvent, handler);
    };
  }, [game, eventBus]);

  // ── Per-frame territory flush ──────────────────────────────────────────
  useFrame(() => {
    const territory = territoryBufRef.current;
    const terrain = terrainBufRef.current;
    const composite = compositeBufRef.current;
    const tex = textureRef.current;
    if (!territory || !terrain || !composite || !tex) return;

    const pending = pendingDirtyTilesRef.current;
    if (pending.length === 0) return;

    // Update territory buffer for changed tiles
    for (const tile of pending) {
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
    for (const tile of pending) {
      const tx = game.x(tile);
      const ty = game.y(tile);
      if (tx >= texWidth || ty >= texHeight) continue;
      const idx = (ty * texWidth + tx) * 4;
      compositePixel(terrain, territory, composite, idx);
    }

    // Signal GPU upload — DataTexture reads directly from the composite buffer
    tex.needsUpdate = true;
    pendingDirtyTilesRef.current = [];
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
        lastMoveX: e.clientX,
        lastMoveY: e.clientY,
        dragging: false,
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
      // Drag-state cleanup MUST run unconditionally — even when `e.uv` is
      // undefined (pointer released off-mesh at a grazing angle, raycast
      // miss, etc). Gating the reset on `e.uv` previously left
      // `pointerDownRef` latched, so subsequent pointermoves still satisfied
      // the drag branch and panned the camera without the button held.
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down) return;

      // Click-vs-drag threshold (same 10px as InputHandler). `dragging` is
      // latched during pointermove once the threshold is crossed, so we
      // honor it even if the pointer ends up back near the down position.
      const dist =
        Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      const button = down.button;
      const wasDragging = down.dragging;

      if (wasDragging || dist >= 10) return; // was a drag, not a click

      // Click-tile logic requires a valid UV; tile coordinate resolution is
      // impossible without it. State has already been cleared above.
      if (!e.uv) return;

      if (button === 0) {
        const { tileX, tileY } = uvToTile(e.uv);
        const native = e.nativeEvent;

        // Parity with legacy InputHandler.onPointerUp:
        //   modifierKey + click → directly open the BuildMenu at the tile.
        //   altKey      + click → directly open the EmojiMenu at the tile.
        // These used to be emitted from the canvas input path and are
        // required so BuildMenu / EmojiTable stay reachable during play.
        // Use keybind-aware checks so users who remap modifierKey / altKey
        // still get the expected menu shortcuts in the R3F pointer pipeline.
        if (isModifierKeyPressed(native, keybinds)) {
          eventBus.emit(new ShowBuildMenuEvent(tileX, tileY));
          return;
        }
        if (isAltKeyPressed(native, keybinds)) {
          eventBus.emit(new ShowEmojiMenuEvent(tileX, tileY));
          return;
        }

        // Honour leftClickOpensMenu user setting
        if (userSettings.leftClickOpensMenu() && !native.shiftKey) {
          eventBus.emit(
            new ContextMenuEvent(
              tileX,
              tileY,
              true,
              e.clientX,
              e.clientY,
            ),
          );
        } else {
          eventBus.emit(new MouseUpEvent(tileX, tileY, true));
        }
      }
      // Right-click (button === 2) is handled exclusively by onContextMenu
    },
    [eventBus, uvToTile, keybinds],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // If a window-level drag handler is active (pointer re-entered the
      // mesh while dragging), clean it up so this mesh handler takes over
      // without double-emitting DragEvents.
      if (windowDragCleanupRef.current) {
        windowDragCleanupRef.current();
      }

      // Left-button drag pans the camera. We emit DragEvent(dx, dy) with
      // screen-space deltas relative to the previous move sample; the
      // CameraController's onDrag handler already converts these into
      // camera-space translations (matching keyboard WASD pan).
      //
      // Gate drag emission on the primary button still being pressed
      // (e.buttons bit 0). If the user released outside the mesh, we may
      // not have received an onPointerUp for the mesh, so pointerDownRef
      // could still be populated — without this guard subsequent hover
      // moves would keep panning the camera unexpectedly.
      const down = pointerDownRef.current;
      const primaryPressed = (e.nativeEvent.buttons & 1) !== 0;
      if (down && down.button === 0 && primaryPressed) {
        const dx = e.clientX - down.lastMoveX;
        const dy = e.clientY - down.lastMoveY;
        if (dx !== 0 || dy !== 0) {
          down.lastMoveX = e.clientX;
          down.lastMoveY = e.clientY;
          // Once total displacement crosses the 10px click threshold,
          // latch `dragging` so pointerUp suppresses the click action
          // regardless of where the pointer ends up.
          const totalDist =
            Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
          if (totalDist >= 10) down.dragging = true;
          eventBus.emit(new DragEvent(dx, dy));
        }
      } else if (down && !primaryPressed) {
        // Release happened off-mesh and we never saw an onPointerUp. Drop
        // the stale pointer-down state so the next hover doesn't resume
        // dragging.
        pointerDownRef.current = null;
      }

      if (!e.uv) return;
      const { tileX, tileY } = uvToTile(e.uv);
      eventBus.emit(new TileHoverEvent(tileX, tileY));
    },
    [eventBus, uvToTile],
  );

  const onPointerOut = useCallback(() => {
    // Pointer left the map mesh — always clear any cached hover tile
    // downstream so hotkey actions don't fire on a stale target.
    eventBus.emit(new TileHoverClearEvent());

    // If a drag is active (primary button held), keep the drag alive by
    // installing a temporary window-level pointermove listener so
    // DragEvent continues while the button remains held outside the mesh.
    // This mirrors legacy InputHandler behaviour where window-level
    // pointermove kept panning alive until pointerup.
    const down = pointerDownRef.current;
    if (down && down.button === 0) {
      const onWindowMove = (e: PointerEvent) => {
        const d = pointerDownRef.current;
        if (!d || (e.buttons & 1) === 0) {
          // Button released or state cleared — clean up.
          pointerDownRef.current = null;
          cleanup();
          return;
        }
        const dx = e.clientX - d.lastMoveX;
        const dy = e.clientY - d.lastMoveY;
        if (dx !== 0 || dy !== 0) {
          d.lastMoveX = e.clientX;
          d.lastMoveY = e.clientY;
          const totalDist =
            Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
          if (totalDist >= 10) d.dragging = true;
          eventBus.emit(new DragEvent(dx, dy));
        }
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onWindowMove);
        windowDragCleanupRef.current = null;
      };
      // Remove any stale handler before adding the new one.
      windowDragCleanupRef.current?.();
      window.addEventListener("pointermove", onWindowMove);
      windowDragCleanupRef.current = cleanup;
      return;
    }

    // No active drag — drop stale pointer-down state so the next hover
    // doesn't resume dragging.
    pointerDownRef.current = null;
  }, [eventBus]);

  const onPointerCancel = useCallback(() => {
    // Pointer cancellation (OS-level interruption, touch gesture hijack,
    // etc.) invalidates any in-flight drag — drop it so the next move
    // doesn't resume panning.
    pointerDownRef.current = null;
    windowDragCleanupRef.current?.();
  }, []);

  // Window-level cleanup: ensure `pointerDownRef` is reset even when the
  // release lands outside the mesh (mesh-scoped onPointerUp may never fire
  // in that case). Without this, a later pointermove inside the mesh could
  // still satisfy the drag branch and scroll the camera unexpectedly. Also
  // covers pointercancel (gesture interruption) and blur (window loses
  // focus while the button is held).
  useEffect(() => {
    const reset = () => {
      pointerDownRef.current = null;
      windowDragCleanupRef.current?.();
    };
    window.addEventListener("pointerup", reset);
    window.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("pointerup", reset);
      window.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      windowDragCleanupRef.current?.();
    };
  }, []);

  const onContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.nativeEvent.preventDefault();
      e.stopPropagation();

      // Mirror legacy InputHandler.onContextMenu: if a ghost structure is
      // active, right-click cancels it instead of opening the radial/context
      // menu. This prevents an unintended build on the next left-click.
      if (useHUDStore.getState().ghostStructure !== null) {
        eventBus.emit(new GhostStructureChangedEvent(null));
        return;
      }

      if (!e.uv) return;

      const { tileX, tileY } = uvToTile(e.uv);
      eventBus.emit(
        new ContextMenuEvent(
          tileX,
          tileY,
          true,
          e.nativeEvent.clientX,
          e.nativeEvent.clientY,
        ),
      );
    },
    [eventBus, uvToTile],
  );

  // ── Geometry (plane sized to map) ───────────────────────────────────────
  const geometry = useMemo(
    () => new PlaneGeometry(mapWidth, mapHeight),
    [mapWidth, mapHeight],
  );

  if (!textureReady || !textureRef.current) return null;

  return (
    <mesh
      geometry={geometry}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onPointerCancel={onPointerCancel}
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
