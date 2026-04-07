import { useFrame } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef } from "react";
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  TubeGeometry,
  Vector3,
} from "three";
import { GameUpdates } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import {
  GameUpdateType,
  HyperspaceLaneConstructionUpdate,
  HyperspaceLaneDestructionUpdate,
  HyperspaceLaneSnapUpdate,
} from "../../core/game/GameUpdates";
import { useGameView } from "../bridge/GameViewContext";
import { SceneTickEvent } from "../InputHandler";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Glow tube radius for warp lanes. */
const LANE_RADIUS = 0.4;
/** Tube segments per tile in the path. */
const TUBE_SEGMENTS_PER_TILE = 2;
/** Radial segments of the tube cross-section. */
const TUBE_RADIAL_SEGMENTS = 4;
/** Height above the map plane for warp lanes. */
const LANE_HEIGHT = 1.0;
/** Base emissive intensity for warp lanes. */
const BASE_EMISSIVE = 0.6;
/** Pulse amplitude added on top of base emissive. */
const PULSE_AMPLITUDE = 0.4;
/** Pulse speed in Hz. */
const PULSE_SPEED = 1.2;

// ─── Internal state types ───────────────────────────────────────────────────

interface LaneState {
  /** Railroad ID. */
  id: number;
  /** Tile path for this lane. */
  tiles: TileRef[];
  /** The tube mesh in the scene. */
  tubeMesh: Mesh;
  /** Outer glow line. */
  glowLine: Line;
  /** Material for emissive pulsing. */
  material: MeshBasicMaterial;
  /** Glow material. */
  glowMaterial: LineBasicMaterial;
  /** Animation progress for construction (0..1, 1 = fully built). */
  buildProgress: number;
  /** Whether construction animation is complete. */
  built: boolean;
  /** World-space points along the lane (for freighter positioning). */
  worldPoints: Vector3[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tileToWorld(
  game: {
    x: (t: TileRef) => number;
    y: (t: TileRef) => number;
    width: () => number;
    height: () => number;
  },
  tile: TileRef,
): Vector3 {
  const halfW = game.width() / 2;
  const halfH = game.height() / 2;
  return new Vector3(
    game.x(tile) - halfW,
    -(game.y(tile) - halfH),
    LANE_HEIGHT,
  );
}

function buildLaneCurve(points: Vector3[]): CatmullRomCurve3 | null {
  if (points.length < 2) return null;
  // For very short paths use the points directly (CatmullRom needs at least 2)
  return new CatmullRomCurve3(points, false, "catmullrom", 0.3);
}

function createLaneMeshes(
  points: Vector3[],
): {
  tubeMesh: Mesh;
  glowLine: Line;
  material: MeshBasicMaterial;
  glowMaterial: LineBasicMaterial;
} | null {
  const curve = buildLaneCurve(points);
  if (!curve) return null;

  const segments = Math.max(4, points.length * TUBE_SEGMENTS_PER_TILE);

  // Core tube
  const tubeGeo = new TubeGeometry(
    curve,
    segments,
    LANE_RADIUS,
    TUBE_RADIAL_SEGMENTS,
    false,
  );
  const material = new MeshBasicMaterial({
    color: new Color(0.3, 0.6, 1.0),
    transparent: true,
    opacity: 0.85,
  });
  const tubeMesh = new Mesh(tubeGeo, material);

  // Outer glow line (wider, semi-transparent)
  const curvePoints = curve.getPoints(segments);
  const lineGeo = new BufferGeometry().setFromPoints(curvePoints);
  const glowMaterial = new LineBasicMaterial({
    color: new Color(0.4, 0.7, 1.0),
    transparent: true,
    opacity: 0.3,
    linewidth: 1,
  });
  const glowLine = new Line(lineGeo, glowMaterial);

  return { tubeMesh, glowLine, material, glowMaterial };
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * WarpLaneRenderer — renders railroads as glowing animated "warp lanes".
 *
 * - Ingests railroad construction/destruction/snap updates from an
 *   {@link SceneTickEvent} emitted once per game tick by
 *   {@link ClientGameRunner}. This guarantees every tick is processed
 *   exactly once — polling `GameView.updatesSinceLastTick()` from
 *   `useFrame` would drop intermediate ticks during catch-up / reconnects.
 * - Maintains an authoritative `laneSpecsRef` (id → tiles) so rendered
 *   lanes can be deterministically rebuilt from scratch on remount or
 *   after an explicit resync.
 * - Renders each lane as a TubeGeometry with emissive pulsing animation.
 * - Cargo freighter (Train) units are positioned along lane paths in
 *   UnitRenderer, but this component provides the visual lane infrastructure.
 */
export function WarpLaneRenderer(): React.JSX.Element {
  const { gameView: game, eventBus } = useGameView();

  const groupRef = useRef<Group>(null);
  const lanesRef = useRef<Map<number, LaneState>>(new Map());
  /**
   * Authoritative lane specs (id → tile path) — the set of lanes that
   * *should* exist based on every construction/snap/destruction event we
   * have observed. Used by {@link resyncLanes} to rebuild rendered meshes
   * from scratch after a remount or missed state.
   */
  const laneSpecsRef = useRef<Map<number, TileRef[]>>(new Map());
  const elapsedRef = useRef(0);

  // ── Lane management helpers ─────────────────────────────────────────

  const addLaneMeshes = useCallback(
    (id: number, tiles: TileRef[]) => {
      if (lanesRef.current.has(id)) return;
      if (!groupRef.current) return;
      if (tiles.length < 2) return;

      const worldPoints = tiles.map((t) => tileToWorld(game, t));
      const meshes = createLaneMeshes(worldPoints);
      if (!meshes) return;

      const lane: LaneState = {
        id,
        tiles,
        tubeMesh: meshes.tubeMesh,
        glowLine: meshes.glowLine,
        material: meshes.material,
        glowMaterial: meshes.glowMaterial,
        buildProgress: 0,
        built: false,
        worldPoints,
      };

      groupRef.current.add(lane.tubeMesh);
      groupRef.current.add(lane.glowLine);
      lanesRef.current.set(id, lane);
    },
    [game],
  );

  const disposeLaneMeshes = useCallback((lane: LaneState) => {
    if (groupRef.current) {
      groupRef.current.remove(lane.tubeMesh);
      groupRef.current.remove(lane.glowLine);
    }
    lane.tubeMesh.geometry.dispose();
    lane.material.dispose();
    lane.glowLine.geometry.dispose();
    lane.glowMaterial.dispose();
  }, []);

  const removeLaneMeshes = useCallback(
    (id: number) => {
      const lane = lanesRef.current.get(id);
      if (!lane) return;
      disposeLaneMeshes(lane);
      lanesRef.current.delete(id);
    },
    [disposeLaneMeshes],
  );

  const addLane = useCallback(
    (id: number, tiles: TileRef[]) => {
      laneSpecsRef.current.set(id, tiles);
      addLaneMeshes(id, tiles);
    },
    [addLaneMeshes],
  );

  const removeLane = useCallback(
    (id: number) => {
      laneSpecsRef.current.delete(id);
      removeLaneMeshes(id);
    },
    [removeLaneMeshes],
  );

  /**
   * Deterministic resync path — dispose all currently rendered lane meshes
   * and rebuild them from {@link laneSpecsRef}. Safe to call at any time;
   * used on mount so remounts reconstruct rendered state from the
   * authoritative spec map rather than relying on replayed deltas.
   */
  const resyncLanes = useCallback(() => {
    for (const lane of lanesRef.current.values()) {
      disposeLaneMeshes(lane);
    }
    lanesRef.current.clear();

    if (!groupRef.current) return;
    for (const [id, tiles] of laneSpecsRef.current) {
      addLaneMeshes(id, tiles);
      const lane = lanesRef.current.get(id);
      if (lane) {
        // Lanes rebuilt from spec are already considered "built" — skip the
        // construction fade-in so a remount does not re-trigger build-in.
        lane.buildProgress = 1;
        lane.built = true;
      }
    }
  }, [addLaneMeshes, disposeLaneMeshes]);

  // ── Process a single tick's updates ────────────────────────────────
  const processTickUpdates = useCallback(
    (updates: GameUpdates) => {
      // Construction
      const constructions =
        updates[GameUpdateType.HyperspaceLaneConstructionEvent];
      if (constructions) {
        for (const update of constructions) {
          if (!update) continue;
          const cu = update as HyperspaceLaneConstructionUpdate;
          addLane(cu.id, cu.tiles);
        }
      }

      // Snap (split one railroad into two)
      const snaps = updates[GameUpdateType.HyperspaceLaneSnapEvent];
      if (snaps) {
        for (const update of snaps) {
          if (!update) continue;
          const su = update as HyperspaceLaneSnapUpdate;
          removeLane(su.originalId);
          addLane(su.newId1, su.tiles1);
          addLane(su.newId2, su.tiles2);
        }
      }

      // Destruction
      const destructions =
        updates[GameUpdateType.HyperspaceLaneDestructionEvent];
      if (destructions) {
        for (const update of destructions) {
          if (!update) continue;
          const du = update as HyperspaceLaneDestructionUpdate;
          removeLane(du.id);
        }
      }
    },
    [addLane, removeLane],
  );

  // ── Tick-driven ingestion via EventBus ──────────────────────────────
  useEffect(() => {
    const handler = (event: SceneTickEvent) => {
      processTickUpdates(event.updates);
    };
    eventBus.on(SceneTickEvent, handler);

    // On mount, rebuild any previously-known lanes from the authoritative
    // spec map. This handles component remounts mid-session — without this
    // the rendered lane set would lag until new deltas arrived.
    resyncLanes();

    return () => {
      eventBus.off(SceneTickEvent, handler);
      // Dispose every tracked lane mesh/geometry/material on unmount so
      // repeated session transitions do not leak GPU resources.
      for (const lane of lanesRef.current.values()) {
        disposeLaneMeshes(lane);
      }
      lanesRef.current.clear();
    };
  }, [eventBus, processTickUpdates, resyncLanes, disposeLaneMeshes]);

  // ── Per-frame animation only (NO update polling) ───────────────────
  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const t = elapsedRef.current;

    for (const lane of lanesRef.current.values()) {
      // Construction build-in animation
      if (!lane.built) {
        lane.buildProgress = Math.min(1, lane.buildProgress + delta * 2);
        if (lane.buildProgress >= 1) lane.built = true;
        lane.material.opacity = 0.85 * lane.buildProgress;
        lane.glowMaterial.opacity = 0.3 * lane.buildProgress;
      }

      // Emissive pulsing effect
      const pulse =
        BASE_EMISSIVE +
        PULSE_AMPLITUDE * Math.sin(t * PULSE_SPEED * Math.PI * 2);
      const intensity = pulse * (lane.built ? 1 : lane.buildProgress);
      lane.material.color.setRGB(
        0.3 * intensity,
        0.6 * intensity,
        1.0 * intensity,
      );
      lane.glowMaterial.color.setRGB(
        0.4 * intensity,
        0.7 * intensity,
        1.0 * intensity,
      );
    }
  });

  return <group ref={groupRef} />;
}
