import React, { useCallback, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3, MOUSE } from "three";
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

/** Default camera elevation angle in radians (~45°). */
const DEFAULT_ELEVATION = Math.PI / 4;

/** Smooth interpolation factor per second for GoTo animations. */
const LERP_SPEED = 3;

/** Distance threshold to consider a GoTo animation complete. */
const ARRIVAL_THRESHOLD = 2;

/** How far behind the target (relative to map center) the camera sits. */
const BEHIND_TARGET_FACTOR = 0.3;

/** Polar angle constraints to prevent flipping below or edge-on to the plane. */
const MIN_POLAR_ANGLE = 0.1; // ~6° from straight down
const MAX_POLAR_ANGLE = Math.PI * 0.47; // ~85° from top

// Scratch vectors reused every frame
const _v = new Vector3();
const _dir = new Vector3();

/**
 * CameraController — 3D orbit camera with:
 *   - OrbitControls for drag-to-pan, scroll-to-zoom, and middle-drag orbit
 *   - Angled default view (~45° elevation looking at map center)
 *   - EventBus integration for GoToPlayer/Position/Unit + CenterCamera
 *   - Keyboard WASD/QE pan/zoom forwarded from InputHandler as DragEvent/ZoomEvent
 *   - "Position behind target" focus logic for GoTo animations
 *
 * The camera views the map plane (z=0) from an elevated angle.
 * "Zoom" adjusts distance from the target point.
 */
export function CameraController(): React.JSX.Element {
  const { gameView: game, eventBus } = useGameView();
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // ── Animation state for GoTo ──────────────────────────────────────────
  const targetRef = useRef<Vector3 | null>(null);
  const cameraGoalRef = useRef<Vector3 | null>(null);
  const animating = useRef(false);

  // ── Initial camera placement (angled view) ────────────────────────────
  useEffect(() => {
    const mapH = game.height();
    // Position camera at ~45° elevation behind the map center
    const cx = 0;
    const cy = -mapH * 0.4;
    const cz = mapH * 0.5;
    camera.position.set(cx, cy, cz);
    camera.up.set(0, 0, 1); // Z-up world convention for orbit

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [camera, game]);

  // Expose the Three.js camera for Playwright E2E tests so
  // `tileToScreen` can use real projection matrices.
  useEffect(() => {
    if (process.env.GAME_ENV !== "prod") {
      const w = window as unknown as { __threeCamera?: typeof camera };
      w.__threeCamera = camera;
      return () => {
        delete w.__threeCamera;
      };
    }
  }, [camera]);

  // ── GoTo helpers ──────────────────────────────────────────────────────

  /**
   * Calculate a camera position that is offset "behind" the target relative
   * to the map center, mimicking a cinematic fly-to effect.
   */
  const computeCameraGoal = useCallback(
    (targetPos: Vector3): Vector3 => {
      // Direction from map center to target
      _dir.set(targetPos.x, targetPos.y, 0).normalize();
      // If target is at map center, default to looking from the south
      if (_dir.lengthSq() < 0.001) _dir.set(0, -1, 0);

      const currentDist = camera.position.distanceTo(
        controlsRef.current?.target ?? new Vector3(),
      );
      const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, currentDist));

      // Position camera behind the target (relative to map center),
      // at the current viewing height, maintaining ~45° elevation
      const offset = height * BEHIND_TARGET_FACTOR;
      return new Vector3(
        targetPos.x + _dir.x * offset,
        targetPos.y + _dir.y * offset,
        height * Math.sin(DEFAULT_ELEVATION),
      );
    },
    [camera],
  );

  const startGoTo = useCallback(
    (worldX: number, worldY: number) => {
      // Convert tile coords (origin top-left) to plane coords (origin center)
      const mapW = game.width();
      const mapH = game.height();
      const planeX = worldX - mapW / 2;
      const planeY = -(worldY - mapH / 2); // flip Y: tile Y goes down, plane Y goes up
      const target = new Vector3(planeX, planeY, 0);
      targetRef.current = target;
      cameraGoalRef.current = computeCameraGoal(target);
      animating.current = true;
    },
    [game, computeCameraGoal],
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
      // Keyboard WASD fires DragEvent — translate to camera movement.
      // With rotation enabled, pan along the camera's local XY plane by
      // adjusting the OrbitControls target.
      if (animating.current) {
        animating.current = false;
        targetRef.current = null;
        cameraGoalRef.current = null;
      }
      if (!controlsRef.current) return;

      const controls = controlsRef.current;
      // Scale drag by current zoom distance (distance from target)
      const dist = camera.position.distanceTo(controls.target);
      const zoomScale = dist / DEFAULT_HEIGHT;
      const dx = -e.deltaX * zoomScale;
      const dy = e.deltaY * zoomScale; // flip Y

      // Move in camera-local XY plane: get camera's right and up vectors
      // projected onto the XZ ground plane for intuitive panning.
      _v.set(dx, dy, 0).applyQuaternion(camera.quaternion);
      // Zero out Z component so panning stays on the ground plane
      _v.z = 0;

      camera.position.add(_v);
      controls.target.add(_v);
      controls.update();
    },
    [camera],
  );

  const onZoom = useCallback(
    (e: ZoomEvent) => {
      // Keyboard QE fires ZoomEvent — adjust camera distance from target
      if (animating.current) {
        animating.current = false;
        targetRef.current = null;
        cameraGoalRef.current = null;
      }
      if (!controlsRef.current) return;

      const controls = controlsRef.current;
      const dist = camera.position.distanceTo(controls.target);
      const zoomFactor = 1 + e.delta / 600;
      const newDist = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dist * zoomFactor));

      // Scale camera position along the look direction
      _v.copy(camera.position).sub(controls.target).normalize().multiplyScalar(newDist);
      camera.position.copy(controls.target).add(_v);
      controls.update();
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
    if (!animating.current || !targetRef.current || !cameraGoalRef.current || !controlsRef.current)
      return;

    const target = targetRef.current;
    const cameraGoal = cameraGoalRef.current;
    const controls = controlsRef.current;

    // Exponential smoothing
    const t = 1 - Math.exp(-LERP_SPEED * delta);

    // Lerp the controls target (look-at point on the map plane)
    controls.target.lerp(target, t);

    // Lerp camera position to the computed behind-target goal
    camera.position.lerp(cameraGoal, t);

    controls.update();

    // Check arrival
    const dx = controls.target.x - target.x;
    const dy = controls.target.y - target.y;
    if (Math.sqrt(dx * dx + dy * dy) < ARRIVAL_THRESHOLD) {
      animating.current = false;
      targetRef.current = null;
      cameraGoalRef.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      // Enable orbit/tilt with constrained polar angles
      enableRotate={true}
      enablePan={true}
      enableZoom={true}
      // Constrain tilt: prevent flipping below the map plane or going edge-on
      minPolarAngle={MIN_POLAR_ANGLE}
      maxPolarAngle={MAX_POLAR_ANGLE}
      // Zoom distance limits
      minDistance={MIN_HEIGHT}
      maxDistance={MAX_HEIGHT}
      // Screen-space panning for intuitive movement at any angle
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: undefined as unknown as number, // handled by SpaceMapPlane
        MIDDLE: MOUSE.ROTATE, // middle-drag orbits
        RIGHT: undefined as unknown as number, // context menu
      }}
      // Cancel any GoTo on user interaction
      onStart={() => {
        if (animating.current) {
          animating.current = false;
          targetRef.current = null;
          cameraGoalRef.current = null;
        }
      }}
    />
  );
}
