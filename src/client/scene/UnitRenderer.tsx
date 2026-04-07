import { useFrame } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { FrigateType, UnitType } from "../../core/game/Game";
import { UnitView } from "../../core/game/GameView";
import { useGameView } from "../bridge/GameViewContext";

// ─── Train subtypes for distinct proxy meshes ─────────────────────────────────

export type TrainSubtype =
  | "TrainEngine"
  | "TrainCarriage"
  | "TrainLoadedCarriage";

/**
 * A render key identifies a distinct instanced-mesh pool.
 * Most unit types map 1:1; trains split into subtypes.
 */
export type RenderKey = UnitType | TrainSubtype;

function trainSubtype(unit: UnitView): TrainSubtype {
  const tt = unit.frigateType();
  if (tt === FrigateType.Engine || tt === FrigateType.TailEngine) {
    return "TrainEngine";
  }
  return unit.isLoaded() ? "TrainLoadedCarriage" : "TrainCarriage";
}

/**
 * Maps a live `UnitView` to the render key of the instanced-mesh pool it
 * belongs to. Exported so tests can verify the full mapping (and future GLTF
 * asset registries can reuse the same bucketing).
 */
export function renderKeyFor(unit: UnitView): RenderKey {
  if (unit.type() === UnitType.Frigate) return trainSubtype(unit);
  return unit.type();
}

// ─── Proxy geometry definitions ──────────────────────────────────────────────

function createProxyGeometry(key: RenderKey): BufferGeometry {
  switch (key) {
    // Mobile units
    case UnitType.AssaultShuttle:
      return new ConeGeometry(1.5, 4, 8);
    case UnitType.Battlecruiser:
      return new BoxGeometry(2, 6, 2);
    case UnitType.TradeFreighter:
      return new ConeGeometry(2.5, 4, 8);
    // Train subtypes: engines = cylinder, carriages = box
    case "TrainEngine":
      return new CylinderGeometry(1.5, 1.5, 5, 8);
    case "TrainCarriage":
      return new BoxGeometry(1.8, 4, 1.8);
    case "TrainLoadedCarriage":
      return new BoxGeometry(2.2, 4.5, 2.2);
    case UnitType.PlasmaBolt:
      return new SphereGeometry(0.8, 6, 6);
    case UnitType.PointDefenseMissile:
      return new ConeGeometry(0.5, 2, 6);
    case UnitType.AntimatterTorpedo:
      return new SphereGeometry(1.5, 8, 8);
    case UnitType.NovaBomb:
      return new SphereGeometry(2.5, 10, 10);
    case UnitType.ClusterWarhead:
      return new DodecahedronGeometry(2);
    case UnitType.ClusterWarheadSubmunition:
      return new SphereGeometry(0.8, 6, 6);
    // Structures
    case UnitType.Colony:
      return new SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    case UnitType.Spaceport:
      return new TorusGeometry(2.5, 0.6, 8, 16);
    case UnitType.Foundry:
      return new BoxGeometry(2.5, 2.5, 6);
    case UnitType.OrbitalStrikePlatform:
      return new CylinderGeometry(2.5, 2.5, 1, 12);
    case UnitType.DefenseStation:
      return new OctahedronGeometry(2);
    case UnitType.PointDefenseArray:
      return new ConeGeometry(2, 3, 8);
    default:
      return new SphereGeometry(1, 8, 8);
  }
}

// ─── Proxy base transforms ───────────────────────────────────────────────────
// The map plane lies in XY with the scene rendering Z as "up" (see
// SpaceMapPlane.tsx — unit positions are set as (px, py, pz) with pz being
// the height above the plane). Three.js primitives (Cylinder/Cone/half-
// Sphere) orient their axis of symmetry along +Y by default, so without a
// base rotation cones lie sideways, silo disks stand on edge, and the city
// hemisphere's dome points horizontally. The per-key `baseRotation` below
// rotates each primitive so its canonical "up" axis aligns with world +Z.
// `baseScale` / `baseOffset` are reserved for future GLTF swaps where the
// authored asset may need additional normalization.

export interface BaseTransform {
  /** Euler rotation (XYZ order, radians) applied before setMatrixAt(). */
  rotation: [number, number, number];
  /** Per-axis scale applied before setMatrixAt(). */
  scale: [number, number, number];
  /** Positional offset (world units) added to the instance's tile position. */
  offset: [number, number, number];
}

const IDENTITY_TRANSFORM: BaseTransform = {
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  offset: [0, 0, 0],
};

/**
 * Rotation around X by π/2 maps the primitive's default +Y axis to world +Z,
 * which is "up" in this Z-up scene. Used for cones/cylinders/hemispheres that
 * should stand upright on the map plane.
 */
const UPRIGHT_Y_TO_Z: [number, number, number] = [Math.PI / 2, 0, 0];

/**
 * Rotation around X by -π/2 maps the primitive's default +Y axis to world -Z
 * (into the map plane). Used for proxies that should appear inverted, e.g.
 * SAMLauncher which reads as a funnel-style launcher with the wide base up.
 */
const INVERTED_Y_TO_Z: [number, number, number] = [-Math.PI / 2, 0, 0];

export function createBaseTransform(key: RenderKey): BaseTransform {
  const s = STRUCTURE_SCALES[key as UnitType] ?? 1;
  const uniformScale: [number, number, number] = [s, s, s];

  switch (key) {
    // Cone-shaped projectiles / ships: tip should point up out of the plane.
    case UnitType.AssaultShuttle:
    case UnitType.TradeFreighter:
    case UnitType.PointDefenseMissile:
      return { ...IDENTITY_TRANSFORM, rotation: UPRIGHT_Y_TO_Z };

    // City hemisphere: default is a dome pointing +Y. Rotate so the dome
    // points +Z with the flat equator cut resting on the XY plane.
    case UnitType.Colony:
      return {
        rotation: UPRIGHT_Y_TO_Z,
        scale: uniformScale,
        offset: [0, 0, 0],
      };

    // MissileSilo disk: default is a 1-unit-tall cylinder standing on its
    // edge (axis along +Y). Rotate so the disk lies flat on the map plane.
    case UnitType.OrbitalStrikePlatform:
      return {
        rotation: UPRIGHT_Y_TO_Z,
        scale: uniformScale,
        offset: [0, 0, 0],
      };

    // SAMLauncher: inverted cone with wide base up, narrow tip pointing into
    // the map plane. Replaces the old ad-hoc rotation.x = π override which
    // was authored for a Y-up world and read as sideways here.
    case UnitType.PointDefenseArray:
      return {
        rotation: INVERTED_Y_TO_Z,
        scale: uniformScale,
        offset: [0, 0, 0],
      };

    // Port torus: default TorusGeometry already lies in the XY plane with
    // its hole axis along +Z, so it sits flat on the map without rotation.
    case UnitType.Spaceport:
      return { rotation: [0, 0, 0], scale: uniformScale, offset: [0, 0, 0] };

    // DefensePost / Factory: boxes/octahedrons with structure scaling
    case UnitType.DefenseStation:
    case UnitType.Foundry:
      return { rotation: [0, 0, 0], scale: uniformScale, offset: [0, 0, 0] };

    // Boxes / spheres / dodecahedrons / octahedrons don't have an axial
    // orientation issue, and mobile carriage/engine boxes already lie flat.
    default:
      return IDENTITY_TRANSFORM;
  }
}

// ─── Unit type classification ────────────────────────────────────────────────

const STRUCTURE_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.Colony,
  UnitType.Spaceport,
  UnitType.Foundry,
  UnitType.OrbitalStrikePlatform,
  UnitType.DefenseStation,
  UnitType.PointDefenseArray,
]);

/** All render keys: unit types (excluding Train which is replaced by subtypes) + train subtypes. */
export const ALL_RENDER_KEYS: readonly RenderKey[] = [
  UnitType.AssaultShuttle,
  UnitType.Battlecruiser,
  UnitType.TradeFreighter,
  "TrainEngine",
  "TrainCarriage",
  "TrainLoadedCarriage",
  UnitType.PlasmaBolt,
  UnitType.PointDefenseMissile,
  UnitType.AntimatterTorpedo,
  UnitType.NovaBomb,
  UnitType.ClusterWarhead,
  UnitType.ClusterWarheadSubmunition,
  UnitType.Colony,
  UnitType.Spaceport,
  UnitType.Foundry,
  UnitType.OrbitalStrikePlatform,
  UnitType.DefenseStation,
  UnitType.PointDefenseArray,
];

/** Height above the map plane for mobile units. */
const UNIT_HOVER_HEIGHT = 5;

/** Per-structure-type heights above the map plane, visible from 45° view. */
const STRUCTURE_HEIGHTS: Partial<Record<UnitType, number>> = {
  [UnitType.Colony]: 12,
  [UnitType.Spaceport]: 10,
  [UnitType.Foundry]: 10,
  [UnitType.OrbitalStrikePlatform]: 6,
  [UnitType.DefenseStation]: 8,
  [UnitType.PointDefenseArray]: 6,
};

/** Per-structure-type scale multipliers so structures are prominent from angles. */
const STRUCTURE_SCALES: Partial<Record<UnitType, number>> = {
  [UnitType.Colony]: 2.5,
  [UnitType.Spaceport]: 2.0,
  [UnitType.Foundry]: 2.0,
  [UnitType.OrbitalStrikePlatform]: 1.5,
  [UnitType.DefenseStation]: 2.0,
  [UnitType.PointDefenseArray]: 1.5,
};

/** Unit types that render as 3D arcs when crossing space (non-land) tiles. */
const ARC_SHIP_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.AssaultShuttle,
  UnitType.TradeFreighter,
]);

/** Arc apex height as a fraction of inter-planet distance. */
const ARC_HEIGHT_FACTOR = 0.15;

interface NationWorldPos {
  wx: number;
  wy: number;
  tileX: number;
  tileY: number;
}

/**
 * Find the nearest nation (planet) world position to a given tile coordinate.
 */
function findNearestNation(
  tileX: number,
  tileY: number,
  nationPositions: NationWorldPos[],
): NationWorldPos | null {
  let best: NationWorldPos | null = null;
  let bestDist = Infinity;
  for (const n of nationPositions) {
    const dx = tileX - n.tileX;
    const dy = tileY - n.tileY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/**
 * Convert tile coordinates to world-space position. Adds 0.5 to each axis
 * so the result lands on the tile centre — SpaceMapPlane renders one texel
 * per tile on a PlaneGeometry(mapWidth, mapHeight), so a tile's visible
 * centre is half a cell in from each edge.
 */
export function tileToWorld(
  tileX: number,
  tileY: number,
  halfW: number,
  halfH: number,
): { wx: number; wy: number } {
  return {
    wx: tileX + 0.5 - halfW,
    wy: -(tileY + 0.5 - halfH),
  };
}

/** Initial capacity per pool; grows dynamically when exceeded. */
const INITIAL_CAPACITY = 512;

function isStructureKey(key: RenderKey): boolean {
  return STRUCTURE_TYPES.has(key as UnitType);
}

// ─── Model registry ─────────────────────────────────────────────────────────

export interface ModelEntry {
  geometry: BufferGeometry;
  isStructure: boolean;
  /**
   * Base transform applied to every instance of this render key before
   * `setMatrixAt()` so that the proxy geometry is aligned to the map plane's
   * Z-up convention. Kept alongside the geometry so future GLTF swaps can
   * attach their own per-asset transform without touching the per-frame loop.
   */
  baseTransform: BaseTransform;
}

/**
 * Compute the Z offset needed so a geometry's lowest point sits on z=0
 * after the given rotation is applied. Used to ground structure proxies
 * on the map plane instead of relying on a single shared height constant.
 */
function computeGroundingOffset(
  geometry: BufferGeometry,
  rotation: [number, number, number],
): number {
  const clone = geometry.clone();
  const euler = new Euler(rotation[0], rotation[1], rotation[2]);
  const rotMat = new Matrix4().makeRotationFromEuler(euler);
  clone.applyMatrix4(rotMat);
  clone.computeBoundingBox();
  const minZ = clone.boundingBox!.min.z;
  clone.dispose();
  return -minZ;
}

function buildModelRegistry(): Map<RenderKey, ModelEntry> {
  const registry = new Map<RenderKey, ModelEntry>();
  for (const key of ALL_RENDER_KEYS) {
    const geometry = createProxyGeometry(key);
    const baseTransform = createBaseTransform(key);

    // For structures, derive a per-key vertical offset from geometry bounds
    // so each proxy's lowest point rests on z=0 after rotation is applied.
    const isStructure = isStructureKey(key);
    const finalTransform = isStructure
      ? {
          rotation: baseTransform.rotation,
          scale: baseTransform.scale,
          offset: [
            baseTransform.offset[0],
            baseTransform.offset[1],
            computeGroundingOffset(geometry, baseTransform.rotation),
          ] as [number, number, number],
        }
      : baseTransform;

    registry.set(key, {
      geometry,
      isStructure,
      baseTransform: finalTransform,
    });
  }
  return registry;
}

// ─── Dynamic instanced mesh pool ────────────────────────────────────────────

export interface PoolEntry {
  mesh: InstancedMesh;
  capacity: number;
}

function createPoolMesh(
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  capacity: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  // Initialize instanceColor so setColorAt works from the start
  mesh.instanceColor = new InstancedBufferAttribute(
    new Float32Array(capacity * 3),
    3,
  );
  return mesh;
}

// ─── Scratch objects (reused every frame, never GC'd) ───────────────────────

const _obj = new Object3D();
const _color = new Color();

// ─── Interpolation state ────────────────────────────────────────────────────

export interface InterpState {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Timestamp (performance.now) when interpolation started. */
  startTime: number;
  /** Duration in ms for the interpolation. */
  duration: number;
}

/** Duration of one interpolation step in ms. Tuned for ~60fps feel. */
export const INTERP_DURATION_MS = 150;

/**
 * Minimal view of GameView used by the frame-update engine. Keeping it narrow
 * makes it easy for tests to construct deterministic fake snapshots without
 * standing up the full GameView implementation.
 */
export interface UnitRendererGameView {
  width(): number;
  height(): number;
  x(tile: number): number;
  y(tile: number): number;
  units(): Iterable<UnitView>;
  isSector(tile: number): boolean;
  nations(): { coordinates: [number, number]; name: string }[];
}

function createMaterials(): Map<RenderKey, MeshStandardMaterial> {
  const m = new Map<RenderKey, MeshStandardMaterial>();
  for (const key of ALL_RENDER_KEYS) {
    m.set(key, new MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }));
  }
  return m;
}

/**
 * Owns the instanced-mesh pools, interpolation state, and per-frame bucket
 * update for {@link UnitRenderer}. Separating this from the React component
 * lets tests drive deterministic snapshots of `units()` without needing an
 * R3F canvas or `useFrame` loop.
 *
 * All Three.js objects (geometries, materials, meshes) are owned by the
 * engine — call {@link dispose} when finished to release GPU resources.
 */
export class UnitRendererEngine {
  public readonly registry: Map<RenderKey, ModelEntry>;
  public readonly materials: Map<RenderKey, MeshStandardMaterial>;
  public readonly pools: Map<RenderKey, PoolEntry> = new Map();
  public readonly interpMap: Map<number, InterpState> = new Map();
  public readonly lastKnownTile: Map<number, number> = new Map();

  /** Cached stable arc endpoints for ships traversing space (keyed by unit id). */
  public readonly arcEndpoints: Map<
    number,
    { src: NationWorldPos; dst: NationWorldPos }
  > = new Map();

  private readonly group: Group;
  private readonly ownsMaterials: boolean;

  /** Cached nation world positions for arc rendering (computed once per update). */
  private nationPositions: NationWorldPos[] = [];

  constructor(
    group: Group,
    opts: {
      registry?: Map<RenderKey, ModelEntry>;
      materials?: Map<RenderKey, MeshStandardMaterial>;
      initialCapacity?: number;
    } = {},
  ) {
    this.group = group;
    this.registry = opts.registry ?? buildModelRegistry();
    this.materials = opts.materials ?? createMaterials();
    this.ownsMaterials = opts.materials === undefined;

    const capacity = opts.initialCapacity ?? INITIAL_CAPACITY;
    for (const key of ALL_RENDER_KEYS) {
      const entry = this.registry.get(key)!;
      const mat = this.materials.get(key)!;
      const mesh = createPoolMesh(entry.geometry, mat, capacity);
      group.add(mesh);
      this.pools.set(key, { mesh, capacity });
    }
  }

  /**
   * Apply one frame of updates: bucket `game.units()` by render key, clean
   * up interpolation state for despawned units, grow pools if needed, and
   * write instance matrices/colors for every surviving unit.
   *
   * `now` is injected so tests can step through interpolation deterministically
   * (the React component passes `performance.now()`).
   */
  update(game: UnitRendererGameView, now: number): void {
    const mapWidth = game.width();
    const mapHeight = game.height();
    const halfW = mapWidth / 2;
    const halfH = mapHeight / 2;

    // Cache nation world positions for arc rendering (lightweight — ~6-10 nations)
    if (this.nationPositions.length === 0) {
      const nations = game.nations();
      this.nationPositions = nations.map((n) => {
        const w = tileToWorld(n.coordinates[0], n.coordinates[1], halfW, halfH);
        return {
          wx: w.wx,
          wy: w.wy,
          tileX: n.coordinates[0],
          tileY: n.coordinates[1],
        };
      });
    }

    // Bucket active units by render key
    const buckets = new Map<RenderKey, UnitView[]>();
    for (const key of ALL_RENDER_KEYS) buckets.set(key, []);

    const activeUnitIds = new Set<number>();
    for (const unit of game.units()) {
      const key = renderKeyFor(unit);
      const arr = buckets.get(key);
      if (arr) arr.push(unit);
      activeUnitIds.add(unit.id());
    }

    // Clean up interp state for despawned units
    for (const id of this.interpMap.keys()) {
      if (!activeUnitIds.has(id)) {
        this.interpMap.delete(id);
        this.lastKnownTile.delete(id);
        this.arcEndpoints.delete(id);
      }
    }
    for (const id of this.lastKnownTile.keys()) {
      if (!activeUnitIds.has(id)) {
        this.lastKnownTile.delete(id);
      }
    }
    for (const id of this.arcEndpoints.keys()) {
      if (!activeUnitIds.has(id)) {
        this.arcEndpoints.delete(id);
      }
    }

    for (const key of ALL_RENDER_KEYS) {
      const pool = this.pools.get(key);
      if (!pool) continue;

      const entry = this.registry.get(key)!;
      const units = buckets.get(key)!;
      const isStructure = entry.isStructure;
      const baseTransform = entry.baseTransform;

      // ── Dynamic capacity: grow if needed ──
      if (units.length > pool.capacity) {
        const newCapacity = Math.max(units.length * 2, pool.capacity * 2);
        const mat = this.materials.get(key)!;

        // Copy existing matrices/colors to new mesh
        const oldMesh = pool.mesh;
        const newMesh = createPoolMesh(entry.geometry, mat, newCapacity);

        const tmpMatrix = new Matrix4();
        const tmpColor = new Color();
        for (let j = 0; j < oldMesh.count; j++) {
          oldMesh.getMatrixAt(j, tmpMatrix);
          newMesh.setMatrixAt(j, tmpMatrix);
          if (oldMesh.instanceColor) {
            oldMesh.getColorAt(j, tmpColor);
            newMesh.setColorAt(j, tmpColor);
          }
        }

        this.group.remove(oldMesh);
        oldMesh.dispose();
        this.group.add(newMesh);
        pool.mesh = newMesh;
        pool.capacity = newCapacity;

        console.warn(
          `[UnitRenderer] Pool "${key}" grew to capacity ${newCapacity}`,
        );
      }

      const mesh = pool.mesh;
      let i = 0;

      for (const unit of units) {
        const unitId = unit.id();

        let px: number;
        let py: number;
        let pz: number;
        const isArcShip = ARC_SHIP_TYPES.has(key as UnitType);

        if (isStructure) {
          pz = STRUCTURE_HEIGHTS[key as UnitType] ?? 0;
          // Structures: no interpolation — place at tile centre
          const tile = unit.tile();
          const w = tileToWorld(game.x(tile), game.y(tile), halfW, halfH);
          px = w.wx;
          py = w.wy;
        } else {
          pz = UNIT_HOVER_HEIGHT;
          // Mobile units: interpolate between lastTile and tile
          const curTile = unit.tile();
          const prevTile = unit.lastTile();

          const cur = tileToWorld(
            game.x(curTile),
            game.y(curTile),
            halfW,
            halfH,
          );
          const curX = cur.wx;
          const curY = cur.wy;

          const lastTile = this.lastKnownTile.get(unitId);

          if (lastTile !== undefined && lastTile !== curTile) {
            // Tile changed this tick — start new interpolation
            const prev = tileToWorld(
              game.x(prevTile),
              game.y(prevTile),
              halfW,
              halfH,
            );
            this.interpMap.set(unitId, {
              fromX: prev.wx,
              fromY: prev.wy,
              toX: curX,
              toY: curY,
              startTime: now,
              duration: INTERP_DURATION_MS,
            });
          }
          this.lastKnownTile.set(unitId, curTile);

          const interp = this.interpMap.get(unitId);
          if (interp) {
            const elapsed = now - interp.startTime;
            const t = Math.min(elapsed / interp.duration, 1);
            // Smooth-step easing
            const s = t * t * (3 - 2 * t);
            px = interp.fromX + (interp.toX - interp.fromX) * s;
            py = interp.fromY + (interp.toY - interp.fromY) * s;

            if (t >= 1) {
              // Interpolation complete — snap and clean up
              px = interp.toX;
              py = interp.toY;
              this.interpMap.delete(unitId);
            }
          } else {
            px = curX;
            py = curY;
          }

          // ── Arc rendering for transport/trade ships crossing space ──
          // Use stable planet-to-planet endpoints cached for the duration
          // of the ship's space traversal, derived from the ship's source
          // planet and its targetTile (destination planet).
          if (isArcShip && this.nationPositions.length >= 2) {
            if (!game.isSector(curTile)) {
              // Ship is in space — resolve or reuse cached endpoints
              let endpoints = this.arcEndpoints.get(unitId);

              if (!endpoints) {
                // Determine destination planet from unit.targetTile()
                const targetTile = unit.targetTile();
                if (targetTile !== undefined) {
                  const targetTileX = game.x(targetTile);
                  const targetTileY = game.y(targetTile);
                  const curTileX = game.x(curTile);
                  const curTileY = game.y(curTile);

                  const srcPlanet = findNearestNation(
                    curTileX,
                    curTileY,
                    this.nationPositions,
                  );
                  const dstPlanet = findNearestNation(
                    targetTileX,
                    targetTileY,
                    this.nationPositions,
                  );

                  if (srcPlanet && dstPlanet && srcPlanet !== dstPlanet) {
                    endpoints = { src: srcPlanet, dst: dstPlanet };
                    this.arcEndpoints.set(unitId, endpoints);
                  }
                }
              }

              if (endpoints) {
                const totalDx = endpoints.dst.wx - endpoints.src.wx;
                const totalDy = endpoints.dst.wy - endpoints.src.wy;
                const totalDist = Math.sqrt(
                  totalDx * totalDx + totalDy * totalDy,
                );

                if (totalDist > 1) {
                  // Project current position onto the src→dst line for progress
                  const projDx = px - endpoints.src.wx;
                  const projDy = py - endpoints.src.wy;
                  const progress = Math.max(
                    0,
                    Math.min(
                      1,
                      (projDx * totalDx + projDy * totalDy) /
                        (totalDist * totalDist),
                    ),
                  );

                  // Lerp XY between planet centers for smoother visual path
                  px = endpoints.src.wx + totalDx * progress;
                  py = endpoints.src.wy + totalDy * progress;

                  // Parabolic arc: apex at midpoint, height proportional to distance
                  const maxArcHeight = totalDist * ARC_HEIGHT_FACTOR;
                  pz =
                    UNIT_HOVER_HEIGHT +
                    Math.sin(progress * Math.PI) * maxArcHeight;
                }
              }
            } else {
              // Ship returned to land — clear cached endpoints
              this.arcEndpoints.delete(unitId);
            }
          }
        }

        // Apply the per-render-key base transform so the proxy geometry
        // reads as Z-up against the map plane. `baseTransform.offset` lets
        // future GLTF swaps nudge an asset's pivot without touching the
        // interpolation or hover-height math above.
        _obj.position.set(
          px + baseTransform.offset[0],
          py + baseTransform.offset[1],
          pz + baseTransform.offset[2],
        );
        _obj.rotation.set(
          baseTransform.rotation[0],
          baseTransform.rotation[1],
          baseTransform.rotation[2],
        );
        _obj.scale.set(
          baseTransform.scale[0],
          baseTransform.scale[1],
          baseTransform.scale[2],
        );

        _obj.updateMatrix();
        mesh.setMatrixAt(i, _obj.matrix);

        _color.set(unit.owner().territoryColor().toHex());
        mesh.setColorAt(i, _color);

        i++;
      }

      // Only render the active instances
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Release GPU resources and detach meshes from the group. */
  dispose(): void {
    for (const pool of this.pools.values()) {
      this.group.remove(pool.mesh);
      pool.mesh.dispose();
    }
    this.pools.clear();
    if (this.ownsMaterials) {
      for (const mat of this.materials.values()) mat.dispose();
    }
    for (const entry of this.registry.values()) entry.geometry.dispose();
    this.interpMap.clear();
    this.lastKnownTile.clear();
    this.arcEndpoints.clear();
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Renders all game units and structures as instanced 3D proxy meshes.
 *
 * - One `InstancedMesh` per render key → one draw call per visual type.
 * - Train engines and carriages get distinct meshes.
 * - Mobile units interpolate between lastTile and tile for smooth movement.
 * - Pools grow dynamically; no units are silently dropped.
 */
export function UnitRenderer(): React.JSX.Element {
  const { gameView: game } = useGameView();
  const groupRef = useRef<Group>(null);
  const engineRef = useRef<UnitRendererEngine | null>(null);

  // Initialize engine on mount (after the group ref is attached).
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const engine = new UnitRendererEngine(group);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // ── Per-frame update ──────────────────────────────────────────────────
  useFrame(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.update(game as unknown as UnitRendererGameView, performance.now());
  });

  return <group ref={groupRef} />;
}
