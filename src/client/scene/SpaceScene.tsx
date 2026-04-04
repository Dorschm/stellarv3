import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { SpaceMapPlane } from "./SpaceMapPlane";
import { UnitRenderer } from "./UnitRenderer";
import { WarpLaneRenderer } from "./WarpLaneRenderer";
import { FxRenderer } from "./FxRenderer";
import { CameraController } from "./CameraController";

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
      }}
      gl={{ antialias: false, alpha: false }}
      camera={{ position: [0, 0, 500], fov: 60, near: 1, far: 5000 }}
      onCreated={({ gl }) => {
        gl.setClearColor("#050510");
      }}
    >
      {/* Lighting — dim ambient for space feel + directional for 3D mesh readability */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[200, 200, 400]} intensity={1.2} />
      {/* Secondary fill light from below to give ships subtle rim lighting */}
      <directionalLight position={[-100, -100, -200]} intensity={0.3} color="#4488ff" />

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
        <WarpLaneRenderer />
        <UnitRenderer />
        <FxRenderer />
      </Suspense>

      {/* Camera controller: pan, zoom, GoTo via EventBus */}
      <CameraController />
    </Canvas>
  );
}
