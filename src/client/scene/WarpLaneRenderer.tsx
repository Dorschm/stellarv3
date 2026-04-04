import React, { useRef, useCallback } from "react";
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
import { useFrame } from "@react-three/fiber";
import { useGameView } from "../bridge/GameViewContext";
import {
  GameUpdateType,
  RailroadConstructionUpdate,
  RailroadDestructionUpdate,
  RailroadSnapUpdate,
} from "../../core/game/GameUpdates";
import { TileRef } from "../../core/game/GameMap";

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
  game: { x: (t: TileRef) => number; y: (t: TileRef) => number; width: () => number; height: () => number },
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
): { tubeMesh: Mesh; glowLine: Line; material: MeshBasicMaterial; glowMaterial: LineBasicMaterial } | null {
  const curve = buildLaneCurve(points);
  if (!curve) return null;

  const segments = Math.max(4, points.length * TUBE_SEGMENTS_PER_TILE);

  // Core tube
  const tubeGeo = new TubeGeometry(curve, segments, LANE_RADIUS, TUBE_RADIAL_SEGMENTS, false);
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
 * - Reads railroad construction/destruction/snap updates from GameView each tick.
 * - Renders each lane as a TubeGeometry with emissive pulsing animation.
 * - Cargo freighter (Train) units are positioned along lane paths in UnitRenderer,
 *   but this component provides the visual lane infrastructure.
 */
export function WarpLaneRenderer(): React.JSX.Element {
  const { gameView: game } = useGameView();

  const groupRef = useRef<Group>(null);
  const lanesRef = useRef<Map<number, LaneState>>(new Map());
  const elapsedRef = useRef(0);

  const mapWidth = game.width();
  const mapHeight = game.height();

  // ── Lane management helpers ─────────────────────────────────────────

  const addLane = useCallback(
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

  const removeLane = useCallback((id: number) => {
    const lane = lanesRef.current.get(id);
    if (!lane) return;

    if (groupRef.current) {
      groupRef.current.remove(lane.tubeMesh);
      groupRef.current.remove(lane.glowLine);
    }
    lane.tubeMesh.geometry.dispose();
    lane.material.dispose();
    lane.glowLine.geometry.dispose();
    lane.glowMaterial.dispose();
    lanesRef.current.delete(id);
  }, []);

  // ── Per-frame update ────────────────────────────────────────────────
  useFrame((_, delta) => {
    elapsedRef.current += delta;
    const t = elapsedRef.current;

    // ── Process game updates ──────────────────────────────────────────
    const updates = game.updatesSinceLastTick();
    if (updates) {
      // Construction
      const constructions = updates[GameUpdateType.RailroadConstructionEvent];
      if (constructions) {
        for (const update of constructions) {
          if (!update) continue;
          const cu = update as RailroadConstructionUpdate;
          addLane(cu.id, cu.tiles);
        }
      }

      // Snap (split one railroad into two)
      const snaps = updates[GameUpdateType.RailroadSnapEvent];
      if (snaps) {
        for (const update of snaps) {
          if (!update) continue;
          const su = update as RailroadSnapUpdate;
          removeLane(su.originalId);
          addLane(su.newId1, su.tiles1);
          addLane(su.newId2, su.tiles2);
        }
      }

      // Destruction
      const destructions = updates[GameUpdateType.RailroadDestructionEvent];
      if (destructions) {
        for (const update of destructions) {
          if (!update) continue;
          const du = update as RailroadDestructionUpdate;
          removeLane(du.id);
        }
      }
    }

    // ── Animate existing lanes ────────────────────────────────────────
    for (const lane of lanesRef.current.values()) {
      // Construction build-in animation
      if (!lane.built) {
        lane.buildProgress = Math.min(1, lane.buildProgress + delta * 2);
        if (lane.buildProgress >= 1) lane.built = true;
        lane.material.opacity = 0.85 * lane.buildProgress;
        lane.glowMaterial.opacity = 0.3 * lane.buildProgress;
      }

      // Emissive pulsing effect
      const pulse = BASE_EMISSIVE + PULSE_AMPLITUDE * Math.sin(t * PULSE_SPEED * Math.PI * 2);
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
