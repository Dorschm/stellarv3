import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import React, { useMemo, useRef } from "react";
import {
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { Nation } from "../../core/game/TerrainMapLoader";
import { useGameView } from "../bridge/GameViewContext";
import { getPlanetTexture, hashString } from "./PlanetTextureGenerator";
import { tileToWorld } from "./UnitRenderer";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum planet sphere radius (world units). */
const MIN_PLANET_RADIUS = 6;

/** Maximum planet sphere radius (world units). */
const MAX_PLANET_RADIUS = 30;

/** Scale factor converting average tile-distance radius to sphere radius. */
const RADIUS_SCALE = 0.12;

/** Vertical clearance above the sphere bottom to the map plane. */
const PLANET_CLEARANCE = 3;

/** Gap between sphere bottom and the label (world units). */
const LABEL_GAP = 2;

/** Rotation speed (radians per frame) for visual polish. */
const ROTATION_SPEED = 0.001;

/** Emissive colour intensity applied when a planet is owned. The procedural
 *  texture supplies the base look; emissive adds a subtle player-coloured
 *  glow without washing out the pattern the way a `color` multiply would. */
const OWNED_EMISSIVE_INTENSITY = 0.28;

/** Color used for label text. */
const LABEL_COLOR = "#aabbcc";

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derive a per-nation planet radius by sampling outward from the nation's
 * coordinates in 8 directions and averaging the distance to the first
 * non-land tile, then scaling to world units.
 */
function computeNationRadius(
  game: {
    ref(x: number, y: number): number;
    isSector(tile: number): boolean;
    width(): number;
    height(): number;
    isValidCoord(x: number, y: number): boolean;
  },
  cx: number,
  cy: number,
): number {
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ];
  const maxSearch = 300;
  let totalDist = 0;
  let count = 0;

  for (const [dx, dy] of directions) {
    for (let d = 1; d <= maxSearch; d++) {
      const x = cx + dx * d;
      const y = cy + dy * d;
      if (!game.isValidCoord(x, y)) {
        totalDist += d;
        count++;
        break;
      }
      if (!game.isSector(game.ref(x, y))) {
        totalDist += d;
        count++;
        break;
      }
      if (d === maxSearch) {
        totalDist += d;
        count++;
      }
    }
  }

  const avgTileRadius = count > 0 ? totalDist / count : 50;
  return Math.max(
    MIN_PLANET_RADIUS,
    Math.min(MAX_PLANET_RADIUS, avgTileRadius * RADIUS_SCALE),
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Renders 3D planet spheres at each nation position defined in the map manifest.
 *
 * - Spheres float above the map plane as visual landmarks
 * - Sphere radius is derived from the surrounding habitable-zone landmask
 * - Colors reflect territory ownership at the nation's tile coordinate
 * - Labels are billboarded so they always face the camera
 * - Slow rotation for visual polish
 * - No pointer events — clicks pass through to the map plane below
 */
export function PlanetLandmarks(): React.JSX.Element {
  const { gameView: game } = useGameView();

  const mapWidth = game.width();
  const mapHeight = game.height();
  const halfW = mapWidth / 2;
  const halfH = mapHeight / 2;

  const nations = useMemo(() => game.nations(), [game]);

  // Compute per-nation radius from terrain data once
  const nationRadii = useMemo(
    () =>
      nations.map((nation) =>
        computeNationRadius(
          game as unknown as Parameters<typeof computeNationRadius>[0],
          nation.coordinates[0],
          nation.coordinates[1],
        ),
      ),
    [game, nations],
  );

  return (
    <group>
      {nations.map((nation, idx) => (
        <PlanetSphere
          key={`planet-${idx}`}
          nation={nation}
          radius={nationRadii[idx]}
          halfW={halfW}
          halfH={halfH}
          game={game}
        />
      ))}
    </group>
  );
}

// ─── Per-planet sub-component ───────────────────────────────────────────────

interface TileOwner {
  isPlayer(): boolean;
  territoryColor?(tile?: number): { toHex(): string };
}

interface PlanetSphereProps {
  nation: Nation;
  radius: number;
  halfW: number;
  halfH: number;
  game: {
    ref(x: number, y: number): number;
    owner(tile: number): TileOwner;
  };
}

function PlanetSphere({
  nation,
  radius,
  halfW,
  halfH,
  game,
}: PlanetSphereProps): React.JSX.Element {
  const meshRef = useRef<Mesh>(null);
  const matRef = useRef<MeshStandardMaterial>(null);

  // Height so the sphere's bottom sits PLANET_CLEARANCE above the map plane
  const planetHeight = radius + PLANET_CLEARANCE;

  const pos = useMemo(() => {
    const w = tileToWorld(
      nation.coordinates[0],
      nation.coordinates[1],
      halfW,
      halfH,
    );
    return [w.wx, w.wy, planetHeight] as [number, number, number];
  }, [nation.coordinates, halfW, halfH, planetHeight]);

  const tileRef = useMemo(
    () => game.ref(nation.coordinates[0], nation.coordinates[1]),
    [game, nation.coordinates],
  );

  const geometry = useMemo(() => new SphereGeometry(radius, 24, 16), [radius]);

  // Procedural texture: deterministic per nation. Hashing both the name and
  // the coordinates means two nations with the same name on different maps
  // still get different planets, and two coordinates with the same hash are
  // pushed apart by the name component. Module-level cache in
  // PlanetTextureGenerator means re-renders of this component are free.
  const texture: CanvasTexture = useMemo(() => {
    const seed =
      (hashString(nation.name) ^
        Math.imul(nation.coordinates[0], 73856093) ^
        Math.imul(nation.coordinates[1], 19349663)) >>>
      0;
    return getPlanetTexture(seed);
  }, [nation.name, nation.coordinates]);

  // Label offset: below the sphere but above the map plane.
  // world z = planetHeight + labelOffset must be > 0
  const labelOffset = -(radius + LABEL_GAP);

  // Per-frame: slow rotation + emissive ownership tint. The `color` channel
  // stays white so the procedural texture shows unmodified; ownership is
  // signalled with a subtle glow via `emissive` instead.
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += ROTATION_SPEED;
    }

    if (matRef.current) {
      const owner = game.owner(tileRef);
      if (owner.isPlayer() && owner.territoryColor) {
        _planetColor.set(owner.territoryColor(tileRef).toHex());
        matRef.current.emissive.copy(_planetColor);
        matRef.current.emissiveIntensity = OWNED_EMISSIVE_INTENSITY;
      } else {
        matRef.current.emissiveIntensity = 0;
      }
    }
  });

  return (
    <group position={pos}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        raycast={() => {}} // No pointer events — clicks pass through to map
      >
        <meshStandardMaterial
          ref={matRef}
          map={texture}
          color="white"
          emissive="#000000"
          emissiveIntensity={0}
          roughness={0.85}
          metalness={0.05}
        />
      </mesh>

      {/* Billboard name label below the sphere, above the map plane */}
      <Billboard position={[0, 0, labelOffset]}>
        <Text
          fontSize={6}
          color={LABEL_COLOR}
          anchorX="center"
          anchorY="top"
          outlineWidth={0.3}
          outlineColor="#000000"
          raycast={() => {}} // No pointer events — clicks pass through to map
        >
          {nation.name}
        </Text>
      </Billboard>
    </group>
  );
}

// Scratch color reused every frame
const _planetColor = new Color();
