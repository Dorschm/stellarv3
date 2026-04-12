import { useFrame } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from "three";
import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { UnitView } from "../../core/game/GameView";
import { SceneTickEvent } from "../InputHandler";
import { useGameView } from "../bridge/GameViewContext";
import { useHUDStore } from "../bridge/HUDStore";
import { tileToWorld } from "./UnitRenderer";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Height above the map plane for highlight rings. */
const HIGHLIGHT_Z = 2;

/** Colour for selectable gate candidates (green). */
const CANDIDATE_COLOR = new Color(0.4, 0.73, 0.42);

/** Colour for the selected source gate (gold). */
const SOURCE_COLOR = new Color(1.0, 0.84, 0.31);

/** Shared ring geometry dimensions. */
const RING_INNER = 2.5;
const RING_OUTER = 3.5;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Collects all valid gate endpoints (owned + allied, active, non-construction)
 * for the local player. Exported for unit testing.
 */
export function collectReadyGates(
  myPlayer: {
    units: (...types: UnitType[]) => UnitView[];
    allies: () => { units: (...types: UnitType[]) => UnitView[] }[];
  } | null,
): UnitView[] {
  if (!myPlayer) return [];
  const gates: UnitView[] = [];
  for (const g of myPlayer.units(UnitType.JumpGate)) {
    if (g.isActive() && !g.isUnderConstruction()) gates.push(g);
  }
  for (const ally of myPlayer.allies()) {
    for (const g of ally.units(UnitType.JumpGate)) {
      if (g.isActive() && !g.isUnderConstruction()) gates.push(g);
    }
  }
  return gates;
}

/**
 * Derives source candidate tiles for selectSource mode.
 * All ready gates are valid source candidates.
 */
export function sourceHighlightTiles(readyGates: UnitView[]): TileRef[] {
  return readyGates.map((g) => g.tile());
}

/**
 * Derives destination candidate tiles for selectDest mode.
 * All ready gates except the chosen source are valid destinations.
 */
export function destHighlightTiles(
  readyGates: UnitView[],
  sourceTile: TileRef,
): { source: TileRef; destinations: TileRef[] } {
  return {
    source: sourceTile,
    destinations: readyGates
      .filter((g) => g.tile() !== sourceTile)
      .map((g) => g.tile()),
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * R3F scene component that highlights Jump Gate endpoints during gate
 * selection mode. Renders pulsing rings at valid gate positions.
 *
 * - `selectSource`: all valid source gates highlighted in green
 * - `selectDest`: source gate highlighted in gold, destinations in green
 * - `idle`: renders nothing
 */
export function JumpGateHighlightRenderer(): React.JSX.Element | null {
  const { gameView, eventBus } = useGameView();
  const groupRef = useRef<Group>(null);

  const mode = useHUDStore((s) => s.jumpGateMode);
  const sourceTile = useHUDStore((s) => s.jumpGateSourceTile);

  const halfW = gameView.width() / 2;
  const halfH = gameView.height() / 2;

  // Track game-state ticks to force recomputation of gate candidates when
  // game state changes (gates destroyed, deactivated, constructed, alliance
  // changes). Only increments while selection mode is active to avoid
  // unnecessary recalculations during idle play.
  const [gateTick, setGateTick] = useState(0);

  useEffect(() => {
    const handler = () => {
      if (useHUDStore.getState().jumpGateMode !== "idle") {
        setGateTick((t) => t + 1);
      }
    };
    eventBus.on(SceneTickEvent, handler);
    return () => {
      eventBus.off(SceneTickEvent, handler);
    };
  }, [eventBus]);

  // Shared geometries — created once
  const ringGeo = useMemo(
    () => new RingGeometry(RING_INNER, RING_OUTER, 32),
    [],
  );

  // Derive highlight positions — refreshes on mode change, source selection,
  // AND game-state ticks (via gateTick) so stale highlights are removed when
  // gates are destroyed/deactivated/constructed mid-selection.
  const highlights = useMemo(() => {
    if (mode === "idle") return null;

    const myPlayer = gameView.myPlayer();
    const readyGates = collectReadyGates(myPlayer);

    if (mode === "selectSource") {
      const tiles = sourceHighlightTiles(readyGates);
      return tiles.map((t) => ({
        tile: t,
        color: CANDIDATE_COLOR,
      }));
    }

    if (mode === "selectDest" && sourceTile !== null) {
      const { source, destinations } = destHighlightTiles(
        readyGates,
        sourceTile,
      );
      const result = [{ tile: source, color: SOURCE_COLOR }];
      for (const d of destinations) {
        result.push({ tile: d, color: CANDIDATE_COLOR });
      }
      return result;
    }

    return null;
  }, [mode, sourceTile, gameView, gateTick]);

  // Build meshes when highlights change
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Clear previous meshes
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof Mesh) {
        child.material.dispose();
      }
    }

    if (!highlights) return;

    for (const h of highlights) {
      const mat = new MeshBasicMaterial({
        color: h.color,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: 2, // DoubleSide
      });
      const mesh = new Mesh(ringGeo, mat);
      const w = tileToWorld(
        gameView.x(h.tile),
        gameView.y(h.tile),
        halfW,
        halfH,
      );
      mesh.position.set(w.wx, w.wy, HIGHLIGHT_Z);
      group.add(mesh);
    }
  }, [highlights, ringGeo, gameView, halfW, halfH]);

  // Animate pulse (opacity oscillation)
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !highlights) return;
    const t = clock.getElapsedTime();
    const pulse = 0.5 + 0.3 * Math.sin(t * 3);
    for (const child of group.children) {
      if (child instanceof Mesh) {
        (child.material as MeshBasicMaterial).opacity = pulse;
      }
    }
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ringGeo.dispose();
    };
  }, [ringGeo]);

  if (mode === "idle") return null;

  return <group ref={groupRef} />;
}
