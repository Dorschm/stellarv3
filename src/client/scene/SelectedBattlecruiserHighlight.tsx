import { useFrame } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
} from "three";
import { SceneTickEvent } from "../InputHandler";
import { useGameView } from "../bridge/GameViewContext";
import { useHUDStore } from "../bridge/HUDStore";
import { tileToWorld } from "./UnitRenderer";

/**
 * Renders a pulsing cyan ring around the player's currently-selected
 * Battlecruiser. Mirrors the pattern in `JumpGateHighlightRenderer`.
 *
 * The ring follows the cap ship every game tick (cap ships move while
 * patrolling) and disappears the moment selection clears or the unit
 * becomes inactive — so a stale ring never lingers after a destruction.
 *
 * See plans/here-is-a-list-twinkly-dragonfly.md §4.1 (UX) and §4.3
 * (component architecture).
 */
const HIGHLIGHT_Z = 2;
const RING_INNER = 4.5;
const RING_OUTER = 5.8;
const RING_COLOR = new Color(0.3, 0.84, 1); // matches cursor reticle (#4cd7ff)

export function SelectedBattlecruiserHighlight(): React.JSX.Element | null {
  const { gameView, eventBus } = useGameView();
  const meshRef = useRef<Mesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const selectedId = useHUDStore((s) => s.selectedBattlecruiserUnitId);

  const halfW = gameView.width() / 2;
  const halfH = gameView.height() / 2;

  // Re-position the ring on every scene tick so it tracks the cap ship
  // as it patrols.
  const [tickStamp, setTickStamp] = useState(0);
  useEffect(() => {
    if (selectedId === null) return;
    const handler = () => setTickStamp((t) => t + 1);
    eventBus.on(SceneTickEvent, handler);
    return () => {
      eventBus.off(SceneTickEvent, handler);
    };
  }, [eventBus, selectedId]);

  // Resolve the selected cap ship's tile each render. If the unit is
  // gone we render nothing — the cleanup effect in SpaceMapPlane will
  // also clear the selection on the next tick, but this guard prevents
  // a one-frame ghost ring.
  const ring = useMemo(() => {
    if (selectedId === null) return null;
    const unit = gameView.unit?.(selectedId);
    if (!unit || !unit.isActive()) return null;
    const t = unit.tile();
    return tileToWorld(gameView.x(t), gameView.y(t), halfW, halfH);
  }, [selectedId, gameView, halfW, halfH, tickStamp]);

  const ringGeo = useMemo(
    () => new RingGeometry(RING_INNER, RING_OUTER, 48),
    [],
  );
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: 2, // DoubleSide
      }),
    [],
  );

  useEffect(() => {
    return () => {
      ringGeo.dispose();
      material.dispose();
    };
  }, [ringGeo, material]);

  // Pulse the ring opacity for visibility
  useFrame(({ clock }) => {
    if (!meshRef.current || ring === null) return;
    const t = clock.getElapsedTime();
    const pulse = 0.5 + 0.4 * Math.sin(t * 3);
    (meshRef.current.material as MeshBasicMaterial).opacity = pulse;
    dummy.position.set(ring.wx, ring.wy, HIGHLIGHT_Z);
    dummy.updateMatrix();
    meshRef.current.position.copy(dummy.position);
  });

  if (ring === null) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={ringGeo}
      material={material}
      position={[ring.wx, ring.wy, HIGHLIGHT_Z]}
    />
  );
}
