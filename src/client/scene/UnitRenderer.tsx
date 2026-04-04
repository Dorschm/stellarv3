import React, { useRef, useMemo, useEffect } from "react";
import {
  BufferGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  OctahedronGeometry,
  DodecahedronGeometry,
  TorusGeometry,
  Group,
  InstancedMesh,
  InstancedBufferAttribute,
  MeshStandardMaterial,
  Object3D,
  Color,
  Matrix4,
} from "three";
import { useFrame } from "@react-three/fiber";
import { useGameView } from "../bridge/GameViewContext";
import { TrainType, UnitType } from "../../core/game/Game";
import { UnitView } from "../../core/game/GameView";

// ─── Train subtypes for distinct proxy meshes ─────────────────────────────────

type TrainSubtype = "TrainEngine" | "TrainCarriage" | "TrainLoadedCarriage";

/**
 * A render key identifies a distinct instanced-mesh pool.
 * Most unit types map 1:1; trains split into subtypes.
 */
type RenderKey = UnitType | TrainSubtype;

function trainSubtype(unit: UnitView): TrainSubtype {
  const tt = unit.trainType();
  if (tt === TrainType.Engine || tt === TrainType.TailEngine) {
    return "TrainEngine";
  }
  return unit.isLoaded() ? "TrainLoadedCarriage" : "TrainCarriage";
}

function renderKeyFor(unit: UnitView): RenderKey {
  if (unit.type() === UnitType.Train) return trainSubtype(unit);
  return unit.type();
}

// ─── Proxy geometry definitions ──────────────────────────────────────────────

function createProxyGeometry(key: RenderKey): BufferGeometry {
  switch (key) {
    // Mobile units
    case UnitType.TransportShip:
      return new ConeGeometry(1.5, 4, 8);
    case UnitType.Warship:
      return new BoxGeometry(2, 6, 2);
    case UnitType.TradeShip:
      return new ConeGeometry(2.5, 4, 8);
    // Train subtypes: engines = cylinder, carriages = box
    case "TrainEngine":
      return new CylinderGeometry(1.5, 1.5, 5, 8);
    case "TrainCarriage":
      return new BoxGeometry(1.8, 4, 1.8);
    case "TrainLoadedCarriage":
      return new BoxGeometry(2.2, 4.5, 2.2);
    case UnitType.Shell:
      return new SphereGeometry(0.8, 6, 6);
    case UnitType.SAMMissile:
      return new ConeGeometry(0.5, 2, 6);
    case UnitType.AtomBomb:
      return new SphereGeometry(1.5, 8, 8);
    case UnitType.HydrogenBomb:
      return new SphereGeometry(2.5, 10, 10);
    case UnitType.MIRV:
      return new DodecahedronGeometry(2);
    case UnitType.MIRVWarhead:
      return new SphereGeometry(0.8, 6, 6);
    // Structures
    case UnitType.City:
      return new SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    case UnitType.Port:
      return new TorusGeometry(2.5, 0.6, 8, 16);
    case UnitType.Factory:
      return new BoxGeometry(2.5, 2.5, 6);
    case UnitType.MissileSilo:
      return new CylinderGeometry(2.5, 2.5, 1, 12);
    case UnitType.DefensePost:
      return new OctahedronGeometry(2);
    case UnitType.SAMLauncher:
      return new ConeGeometry(2, 3, 8);
    default:
      return new SphereGeometry(1, 8, 8);
  }
}

// ─── Unit type classification ────────────────────────────────────────────────

const STRUCTURE_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
]);

/** All render keys: unit types (excluding Train which is replaced by subtypes) + train subtypes. */
const ALL_RENDER_KEYS: readonly RenderKey[] = [
  UnitType.TransportShip,
  UnitType.Warship,
  UnitType.TradeShip,
  "TrainEngine",
  "TrainCarriage",
  "TrainLoadedCarriage",
  UnitType.Shell,
  UnitType.SAMMissile,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.MissileSilo,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
];

/** Height above the map plane for mobile units. */
const UNIT_HOVER_HEIGHT = 5;
/** Height above the map plane for structures (sit on the surface). */
const STRUCTURE_HEIGHT = 1.5;

/** Initial capacity per pool; grows dynamically when exceeded. */
const INITIAL_CAPACITY = 512;

function isStructureKey(key: RenderKey): boolean {
  return STRUCTURE_TYPES.has(key as UnitType);
}

// ─── Model registry ─────────────────────────────────────────────────────────

interface ModelEntry {
  geometry: BufferGeometry;
  isStructure: boolean;
}

function buildModelRegistry(): Map<RenderKey, ModelEntry> {
  const registry = new Map<RenderKey, ModelEntry>();
  for (const key of ALL_RENDER_KEYS) {
    registry.set(key, {
      geometry: createProxyGeometry(key),
      isStructure: isStructureKey(key),
    });
  }
  return registry;
}

// ─── Dynamic instanced mesh pool ────────────────────────────────────────────

interface PoolEntry {
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

interface InterpState {
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
const INTERP_DURATION_MS = 150;

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

  const mapWidth = game.width();
  const mapHeight = game.height();

  const registry = useMemo(() => buildModelRegistry(), []);

  // Dynamic pools: { mesh, capacity } per render key
  const pools = useRef<Map<RenderKey, PoolEntry>>(new Map());
  // The Three.js group to which meshes are added
  const groupRef = useRef<Group>(null);

  const materials = useMemo(() => {
    const m = new Map<RenderKey, MeshStandardMaterial>();
    for (const key of ALL_RENDER_KEYS) {
      m.set(key, new MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }));
    }
    return m;
  }, []);

  // Initialize pools on mount
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    for (const key of ALL_RENDER_KEYS) {
      const entry = registry.get(key)!;
      const mat = materials.get(key)!;
      const mesh = createPoolMesh(entry.geometry, mat, INITIAL_CAPACITY);
      group.add(mesh);
      pools.current.set(key, { mesh, capacity: INITIAL_CAPACITY });
    }

    return () => {
      for (const pool of pools.current.values()) {
        group.remove(pool.mesh);
        pool.mesh.dispose();
      }
      pools.current.clear();
      for (const mat of materials.values()) mat.dispose();
      for (const entry of registry.values()) entry.geometry.dispose();
    };
  }, [registry, materials]);

  // Per-unit interpolation state, keyed by unit id
  const interpMap = useRef<Map<number, InterpState>>(new Map());
  // Track last known tile per unit for change detection
  const lastKnownTile = useRef<Map<number, number>>(new Map());

  // ── Per-frame update ──────────────────────────────────────────────────
  useFrame(() => {
    const halfW = mapWidth / 2;
    const halfH = mapHeight / 2;
    const now = performance.now();

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
    for (const id of interpMap.current.keys()) {
      if (!activeUnitIds.has(id)) {
        interpMap.current.delete(id);
        lastKnownTile.current.delete(id);
      }
    }

    for (const key of ALL_RENDER_KEYS) {
      const pool = pools.current.get(key);
      if (!pool) continue;

      const units = buckets.get(key)!;
      const isStructure = registry.get(key)!.isStructure;

      // ── Dynamic capacity: grow if needed ──
      if (units.length > pool.capacity) {
        const group = groupRef.current;
        if (group) {
          const newCapacity = Math.max(
            units.length * 2,
            pool.capacity * 2,
          );
          const entry = registry.get(key)!;
          const mat = materials.get(key)!;

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

          group.remove(oldMesh);
          oldMesh.dispose();
          group.add(newMesh);
          pool.mesh = newMesh;
          pool.capacity = newCapacity;

          console.warn(
            `[UnitRenderer] Pool "${key}" grew to capacity ${newCapacity}`,
          );
        }
      }

      const mesh = pool.mesh;
      let i = 0;

      for (const unit of units) {
        const unitId = unit.id();

        let px: number;
        let py: number;
        const pz = isStructure ? STRUCTURE_HEIGHT : UNIT_HOVER_HEIGHT;

        if (isStructure) {
          // Structures: no interpolation
          const tile = unit.tile();
          px = game.x(tile) - halfW;
          py = -(game.y(tile) - halfH);
        } else {
          // Mobile units: interpolate between lastTile and tile
          const curTile = unit.tile();
          const prevTile = unit.lastTile();

          const curX = game.x(curTile) - halfW;
          const curY = -(game.y(curTile) - halfH);

          const lastTile = lastKnownTile.current.get(unitId);

          if (lastTile !== undefined && lastTile !== curTile) {
            // Tile changed this tick — start new interpolation
            const fromX = game.x(prevTile) - halfW;
            const fromY = -(game.y(prevTile) - halfH);
            interpMap.current.set(unitId, {
              fromX,
              fromY,
              toX: curX,
              toY: curY,
              startTime: now,
              duration: INTERP_DURATION_MS,
            });
          }
          lastKnownTile.current.set(unitId, curTile);

          const interp = interpMap.current.get(unitId);
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
              interpMap.current.delete(unitId);
            }
          } else {
            px = curX;
            py = curY;
          }
        }

        _obj.position.set(px, py, pz);
        _obj.rotation.set(0, 0, 0);

        // Per-type rotation overrides
        const unitType = unit.type();
        if (unitType === UnitType.SAMLauncher) {
          _obj.rotation.x = Math.PI; // inverted cone
        } else if (unitType === UnitType.Port) {
          _obj.rotation.x = Math.PI / 2; // torus lies flat
        }

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
  });

  return <group ref={groupRef} />;
}
