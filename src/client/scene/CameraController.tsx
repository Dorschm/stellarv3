import React, { useCallback, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import {
  CenterCameraEvent,
  DragEvent,
  ZoomEvent,
} from "../InputHandler";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "../CameraEvents";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Camera height (Z distance from the map plane at z=0). */
const DEFAULT_HEIGHT = 500;
const MIN_HEIGHT = 20;
const MAX_HEIGHT = 2000;

/** Smooth interpolation factor per second for GoTo animations. */
const LERP_SPEED = 3;

/** Distance threshold to consider a GoTo animation complete. */
const ARRIVAL_THRESHOLD = 2;

/**
 * CameraController — orthographic-style top-down camera with:
 *   - OrbitControls for drag-to-pan and scroll-to-zoom
 *   - EventBus integration for GoToPlayer/Position/Unit + CenterCamera
 *   - Keyboard WASD/QE pan/zoom forwarded from InputHandler as DragEvent/ZoomEvent
 *
 * The camera looks straight down (-Z) at the map plane sitting at z=0.
 * "Zoom" adjusts camera.position.z (height above the plane).
 */
export function CameraController(): React.JSX.Element {
  const { gameView: game, eventBus } = useGameView();
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // ── Animation target for GoTo ─────────────────────────────────────────
  const targetRef = useRef<Vector3 | null>(null);
  const animating = useRef(false);

  // ── Initial camera placement ──────────────────────────────────────────
  useEffect(() => {
    // Center camera over the map
    const cx = 0; // plane is centered at origin
    const cy = 0;
    camera.position.set(cx, cy, DEFAULT_HEIGHT);
    camera.up.set(0, 1, 0);
    camera.lookAt(cx, cy, 0);

    if (controlsRef.current) {
      controlsRef.current.target.set(cx, cy, 0);
      controlsRef.current.update();
    }
  }, [camera, game]);

  // ── GoTo helpers ──────────────────────────────────────────────────────
  const startGoTo = useCallback(
    (worldX: number, worldY: number) => {
      // Convert tile coords (origin top-left) to plane coords (origin center)
      const mapW = game.width();
      const mapH = game.height();
      const planeX = worldX - mapW / 2;
      const planeY = -(worldY - mapH / 2); // flip Y: tile Y goes down, plane Y goes up
      targetRef.current = new Vector3(planeX, planeY, 0);
      animating.current = true;
    },
    [game],
  );

  // ── EventBus listeners ────────────────────────────────────────────────
  const onGoToPlayer = useCallback(
    (e: GoToPlayerEvent) => {
      const loc = e.player.nameLocation();
      if (!loc) return;
      startGoTo(loc.x, loc.y);
    },
    [startGoTo],
  );

  const onGoToPosition = useCallback(
    (e: GoToPositionEvent) => {
      startGoTo(e.x, e.y);
    },
    [startGoTo],
  );

  const onGoToUnit = useCallback(
    (e: GoToUnitEvent) => {
      const tile = e.unit.lastTile();
      startGoTo(game.x(tile), game.y(tile));
    },
    [game, startGoTo],
  );

  const onCenterCamera = useCallback(() => {
    const player = game.myPlayer();
    if (!player || !player.nameLocation()) return;
    const loc = player.nameLocation();
    startGoTo(loc.x, loc.y);
  }, [game, startGoTo]);

  const onDrag = useCallback(
    (e: DragEvent) => {
      // Keyboard WASD fires DragEvent — translate to camera movement
      // Stop any ongoing GoTo animation
      if (animating.current) {
        animating.current = false;
        targetRef.current = null;
      }
      if (!controlsRef.current) return;

      // Scale drag by current zoom height
      const zoomScale = camera.position.z / DEFAULT_HEIGHT;
      const dx = -e.deltaX * zoomScale;
      const dy = e.deltaY * zoomScale; // flip Y

      camera.position.x += dx;
      camera.position.y += dy;
      controlsRef.current.target.x += dx;
      controlsRef.current.target.y += dy;
      controlsRef.current.update();
    },
    [camera],
  );

  const onZoom = useCallback(
    (e: ZoomEvent) => {
      // Keyboard QE fires ZoomEvent — adjust camera Z height
      if (animating.current) {
        animating.current = false;
        targetRef.current = null;
      }
      const zoomFactor = 1 + e.delta / 600;
      const newZ = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, camera.position.z * zoomFactor));
      camera.position.z = newZ;
      if (controlsRef.current) {
        controlsRef.current.update();
      }
    },
    [camera],
  );

  useEventBus(eventBus, GoToPlayerEvent, onGoToPlayer);
  useEventBus(eventBus, GoToPositionEvent, onGoToPosition);
  useEventBus(eventBus, GoToUnitEvent, onGoToUnit);
  useEventBus(eventBus, CenterCameraEvent, onCenterCamera);
  useEventBus(eventBus, DragEvent, onDrag);
  useEventBus(eventBus, ZoomEvent, onZoom);

  // ── Per-frame GoTo animation ──────────────────────────────────────────
  useFrame((_, delta) => {
    if (!animating.current || !targetRef.current || !controlsRef.current) return;

    const target = targetRef.current;
    const controls = controlsRef.current;

    // Lerp the controls target (look-at point on the map plane)
    const t = 1 - Math.exp(-LERP_SPEED * delta);
    controls.target.lerp(target, t);

    // Move camera XY to keep it directly above the target
    camera.position.x += (target.x - camera.position.x) * t;
    camera.position.y += (target.y - camera.position.y) * t;

    controls.update();

    // Check arrival
    const dx = controls.target.x - target.x;
    const dy = controls.target.y - target.y;
    if (Math.sqrt(dx * dx + dy * dy) < ARRIVAL_THRESHOLD) {
      animating.current = false;
      targetRef.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      // Top-down: disable rotation, allow pan and zoom
      enableRotate={false}
      enablePan={true}
      enableZoom={true}
      // Zoom controls camera Z distance
      minDistance={MIN_HEIGHT}
      maxDistance={MAX_HEIGHT}
      // Screen-space panning (no orbit)
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: undefined as unknown as number, // handled by SpaceMapPlane
        MIDDLE: 2, // THREE.MOUSE.DOLLY
        RIGHT: undefined as unknown as number, // context menu
      }}
      // Cancel any GoTo on user interaction
      onStart={() => {
        if (animating.current) {
          animating.current = false;
          targetRef.current = null;
        }
      }}
    />
  );
}
