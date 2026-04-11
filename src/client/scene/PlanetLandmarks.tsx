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
import { Planet } from "../../core/game/Planet";
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

/** Gap between sphere top and the label baseline (world units). */
const LABEL_GAP = 20;

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
 * Derive a planet sphere radius from its `Planet.tileCount()`. Treats the
 * sector as a rough circular disk (`radius = sqrt(tiles / π)`) and scales
 * the result into world units. This replaces the earlier ad-hoc 8-direction
 * sector walk with a single O(1) read off the already-computed sector
 * tile count, and guarantees that two planets with the same tile count
 * render at the same size regardless of shape.
 */
function computePlanetRadius(planet: Planet): number {
  const tiles = planet.tileCount();
  const tileRadius = tiles > 0 ? Math.sqrt(tiles / Math.PI) : 50;
  return Math.max(
    MIN_PLANET_RADIUS,
    Math.min(MAX_PLANET_RADIUS, tileRadius * RADIUS_SCALE),
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

  // GDD §2 — read the authoritative Planet list off the GameView. This
  // replaces the previous ad-hoc per-nation centroid computation with a
  // single `buildPlanets()` result shared with the server and scoring.
  const planets = useMemo(() => game.planets(), [game]);

  // Compute per-planet radius from its tile count (see computePlanetRadius).
  const planetRadii = useMemo(
    () => planets.map((p) => computePlanetRadius(p)),
    [planets],
  );

  return (
    <group>
      {planets.map((planet, idx) => (
        <PlanetSphere
          key={`planet-${planet.id}`}
          planet={planet}
          radius={planetRadii[idx]}
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
  planet: Planet;
  radius: number;
  halfW: number;
  halfH: number;
  game: {
    ref(x: number, y: number): number;
    owner(tile: number): TileOwner;
  };
}

function PlanetSphere({
  planet,
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
    const w = tileToWorld(planet.seedX, planet.seedY, halfW, halfH);
    return [w.wx, w.wy, planetHeight] as [number, number, number];
  }, [planet.seedX, planet.seedY, halfW, halfH, planetHeight]);

  const tileRef = useMemo(
    () => game.ref(planet.seedX, planet.seedY),
    [game, planet.seedX, planet.seedY],
  );

  const geometry = useMemo(() => new SphereGeometry(radius, 24, 16), [radius]);

  // Procedural texture: deterministic per planet. Hashing both the name and
  // the seed coordinates means two planets with the same name on different
  // maps still get different textures, and two coordinates with the same
  // hash are pushed apart by the name component. Module-level cache in
  // PlanetTextureGenerator means re-renders of this component are free.
  const texture: CanvasTexture = useMemo(() => {
    const seed =
      (hashString(planet.name) ^
        Math.imul(planet.seedX, 73856093) ^
        Math.imul(planet.seedY, 19349663)) >>>
      0;
    return getPlanetTexture(seed);
  }, [planet.name, planet.seedX, planet.seedY]);

  // Label offset: ABOVE the sphere top so the label hangs in empty space.
  // Labels placed below the planet at z<0 get alpha-blended away by the
  // back-to-front transparent sort against the (also transparent) map plane,
  // so we anchor above the planet where the dark-space background makes the
  // text legible.
  const labelOffset = radius + LABEL_GAP;

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

      {/* Billboard name label ABOVE the sphere. fontSize is in WORLD units;
          at the default camera distance (~960wu) a value of ~16 renders to
          about 10 screen pixels which is the smallest readable text. */}
      <Billboard position={[0, 0, labelOffset]}>
        <Text
          fontSize={16}
          color={LABEL_COLOR}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.8}
          outlineColor="#000000"
          raycast={() => {}} // No pointer events — clicks pass through to map
        >
          {planet.name}
        </Text>
      </Billboard>
    </group>
  );
}

// Scratch color reused every frame
const _planetColor = new Color();
