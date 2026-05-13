import { useFrame } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import { Color, Mesh, MeshBasicMaterial, TorusGeometry } from "three";
import { useGameView } from "../bridge/GameViewContext";
import { useHUDStore } from "../bridge/HUDStore";
import { tileToWorld } from "./UnitRenderer";

/**
 * Issue #4 — visual confirmation of the currently selected Battlecruiser.
 *
 * Renders a single pulsing gold torus around the cruiser's world position so
 * the user can see at a glance which ship will receive the next move order
 * or hotkey-host build. Position is updated every frame from the live HUD
 * store snapshot so the ring tracks the cruiser as it patrols.
 */

/** Height above the map plane so the ring renders just over the ship. */
const RING_Z = 4;

/** Torus radii — sized to comfortably encircle the cruiser proxy box. */
const RING_RADIUS = 6;
const RING_TUBE = 0.6;

/** Selected-ship colour (gold) — matches the JumpGate source highlight tone. */
const RING_COLOR = new Color(1.0, 0.84, 0.31);

export function CapitalShipSelectionRing(): React.JSX.Element {
  const { gameView: game } = useGameView();
  const meshRef = useRef<Mesh | null>(null);

  const geometry = useMemo(
    () => new TorusGeometry(RING_RADIUS, RING_TUBE, 8, 32),
    [],
  );
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    const selectedId = useHUDStore.getState().selectedBattlecruiserUnitId;
    if (selectedId === null) {
      mesh.visible = false;
      return;
    }
    const unit = useHUDStore.getState().units.get(selectedId);
    if (unit === undefined || !unit.isActive) {
      mesh.visible = false;
      return;
    }
    const halfW = game.width() / 2;
    const halfH = game.height() / 2;
    const tx = game.x(unit.tile);
    const ty = game.y(unit.tile);
    const w = tileToWorld(tx, ty, halfW, halfH);
    mesh.position.set(w.wx, w.wy, RING_Z);
    // Subtle pulse so the ring reads as "live" without competing with
    // the unit's own animation.
    const pulse = 1 + 0.07 * Math.sin(clock.elapsedTime * 4);
    mesh.scale.set(pulse, pulse, 1);
    mesh.visible = true;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      visible={false}
      data-testid="capital-ship-selection-ring"
    />
  );
}

export default CapitalShipSelectionRing;
