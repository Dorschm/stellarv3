import { Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import React, { Suspense } from "react";
import { CameraController } from "./CameraController";
import { FxRenderer } from "./FxRenderer";
import { PlanetLandmarks } from "./PlanetLandmarks";
import { SpaceMapPlane } from "./SpaceMapPlane";
import { UnitRenderer } from "./UnitRenderer";
import { WarpLaneRenderer } from "./WarpLaneRenderer";

/**
 * Top-level R3F scene — the **primary** rendering path.
 *
 * Renders the 3D space map plane with territory visualization, a camera
 * controller for pan/zoom/GoTo, and a starfield background.
 *
 * Pointer events are captured so {@link SpaceMapPlane} can convert UV hits
 * to tile coordinates for the EventBus.
 */
export function SpaceScene(): React.JSX.Element {
  return (
    <Canvas
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        touchAction: "none",
        pointerEvents: "auto",
      }}
      gl={{ antialias: false, alpha: true, premultipliedAlpha: false }}
      camera={{
        position: [0, -300, 350],
        fov: 60,
        near: 1,
        far: 8000,
        up: [0, 0, 1],
      }}
      onCreated={({ gl }) => {
        // Fully transparent clear so the CSS #space-bg starfield behind
        // the canvas shows through deep-space pixels on the map texture.
        gl.setClearColor("#000000", 0);
      }}
    >
      {/* Lighting — dim ambient for space feel + directional for 3D mesh readability.
          Positioned for the default ~45° angled camera view. */}
      <ambientLight intensity={0.5} />
      {/* Key light — above and behind the default camera angle */}
      <directionalLight position={[100, -300, 500]} intensity={1.2} />
      {/* Fill light — opposite side, cool blue tint for space ambiance */}
      <directionalLight
        position={[-200, 200, 300]}
        intensity={0.4}
        color="#4488ff"
      />
      {/* Low-cost static point lights dedicated to FX readability. They sit
          above the map plane and give transient explosions / spawns / nukes
          a dynamic highlight that directional lighting alone can't produce.
          Dynamic per-event point lights are emitted by FxRenderer on top of
          these (see spawnExplosion(..., withLight: true)). */}
      <pointLight
        position={[0, 0, 150]}
        intensity={0.8}
        distance={1200}
        decay={2}
        color="#88bbff"
      />
      <pointLight
        position={[-250, 200, 100]}
        intensity={0.5}
        distance={700}
        decay={2}
        color="#ffaa66"
      />
      <pointLight
        position={[250, -200, 100]}
        intensity={0.5}
        distance={700}
        decay={2}
        color="#66aaff"
      />

      {/* Starfield background */}
      <Stars
        radius={800}
        depth={200}
        count={5000}
        factor={4}
        saturation={0}
        fade
        speed={0.5}
      />

      {/* The game map plane with terrain + territory DataTexture */}
      <Suspense fallback={null}>
        <SpaceMapPlane />
        <PlanetLandmarks />
        <WarpLaneRenderer />
        <UnitRenderer />
        <FxRenderer />
      </Suspense>

      {/* Camera controller: pan, zoom, GoTo via EventBus */}
      <CameraController />
    </Canvas>
  );
}
