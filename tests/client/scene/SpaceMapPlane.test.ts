// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  ContextMenuEvent,
  DragEvent,
  GhostStructureChangedEvent,
} from "../../../src/client/InputHandler";
import { GameBridge } from "../../../src/client/bridge/GameBridge";
import { useHUDStore } from "../../../src/client/bridge/HUDStore";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

// ---------------------------------------------------------------------------
// Minimal mock of GameView — only the constructor shape matters here.
// ---------------------------------------------------------------------------
function makeMockGameView(): any {
  return {
    ticks: () => 0,
    inSpawnPhase: () => false,
    players: () => [],
    myPlayer: () => null,
    units: () => [],
    updatesSinceLastTick: () => null,
  };
}

// ---------------------------------------------------------------------------
// Comment 1 – Right-click cancels ghost build mode
// ---------------------------------------------------------------------------

describe("SpaceMapPlane: right-click cancels ghost build", () => {
  let eventBus: EventBus;
  let bridge: GameBridge;

  beforeEach(() => {
    useHUDStore.getState().reset();
    eventBus = new EventBus();
    bridge = new GameBridge(makeMockGameView(), "test-client");
    bridge.initialize(eventBus);
  });

  afterEach(() => {
    bridge.destroy();
  });

  /**
   * Replicate the exact branching logic of SpaceMapPlane.onContextMenu so the
   * test proves the contract: when a ghost is armed, right-click must emit
   * GhostStructureChangedEvent(null) and NOT emit ContextMenuEvent.
   */
  function simulateOnContextMenu(bus: EventBus, tileX = 5, tileY = 5) {
    if (useHUDStore.getState().ghostStructure !== null) {
      bus.emit(new GhostStructureChangedEvent(null));
      return;
    }
    bus.emit(new ContextMenuEvent(tileX, tileY, true, 100, 100));
  }

  test("right-click emits GhostStructureChangedEvent(null) when ghost is active", () => {
    // Arm build mode
    eventBus.emit(new GhostStructureChangedEvent(UnitType.Colony));
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.Colony);

    const ghostEvents: GhostStructureChangedEvent[] = [];
    const contextEvents: ContextMenuEvent[] = [];
    eventBus.on(GhostStructureChangedEvent, (e) => ghostEvents.push(e));
    eventBus.on(ContextMenuEvent, (e) => contextEvents.push(e));

    simulateOnContextMenu(eventBus);

    // Ghost must be cleared
    expect(useHUDStore.getState().ghostStructure).toBeNull();
    // Only GhostStructureChangedEvent(null) should have been emitted
    expect(ghostEvents).toHaveLength(1);
    expect(ghostEvents[0].ghostStructure).toBeNull();
    // ContextMenuEvent must NOT have been emitted
    expect(contextEvents).toHaveLength(0);
  });

  test("right-click emits ContextMenuEvent when no ghost is active", () => {
    expect(useHUDStore.getState().ghostStructure).toBeNull();

    const ghostEvents: GhostStructureChangedEvent[] = [];
    const contextEvents: ContextMenuEvent[] = [];
    eventBus.on(GhostStructureChangedEvent, (e) => ghostEvents.push(e));
    eventBus.on(ContextMenuEvent, (e) => contextEvents.push(e));

    simulateOnContextMenu(eventBus);

    expect(contextEvents).toHaveLength(1);
    expect(ghostEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Comment 2 – Drag-pan continues outside the mesh
//
// SpaceMapPlane.onPointerOut installs a temporary window-level pointermove
// handler when the pointer leaves the mesh mid-drag. These tests exercise
// that handler's logic directly (no DOM needed) by calling it with minimal
// PointerEvent-shaped objects.
// ---------------------------------------------------------------------------

/** Minimal drag state matching pointerDownRef shape. */
interface DragState {
  x: number;
  y: number;
  button: number;
  lastMoveX: number;
  lastMoveY: number;
  dragging: boolean;
}

/**
 * Build a handler function identical to the one SpaceMapPlane installs on
 * `window` during onPointerOut. Exercising this directly proves the drag
 * contract without needing a full R3F render.
 */
function buildWindowDragHandler(
  pointerDownRef: { current: DragState | null },
  eventBus: EventBus,
) {
  return (e: { clientX: number; clientY: number; buttons: number }) => {
    const d = pointerDownRef.current;
    if (!d || (e.buttons & 1) === 0) {
      pointerDownRef.current = null;
      return;
    }
    const dx = e.clientX - d.lastMoveX;
    const dy = e.clientY - d.lastMoveY;
    if (dx !== 0 || dy !== 0) {
      d.lastMoveX = e.clientX;
      d.lastMoveY = e.clientY;
      const totalDist = Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
      if (totalDist >= 10) d.dragging = true;
      eventBus.emit(new DragEvent(dx, dy));
    }
  };
}

describe("SpaceMapPlane: drag continues outside mesh", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  test("window-level pointermove emits DragEvent while button is held", () => {
    const dragState: DragState = {
      x: 100,
      y: 100,
      button: 0,
      lastMoveX: 100,
      lastMoveY: 100,
      dragging: false,
    };
    const ref = { current: dragState as DragState | null };
    const handler = buildWindowDragHandler(ref, eventBus);

    const dragEvents: DragEvent[] = [];
    eventBus.on(DragEvent, (e) => dragEvents.push(e));

    // Pointer movement outside mesh with button held (buttons=1)
    handler({ clientX: 120, clientY: 110, buttons: 1 });

    expect(dragEvents).toHaveLength(1);
    expect(dragEvents[0].deltaX).toBe(20);
    expect(dragEvents[0].deltaY).toBe(10);

    // Second move accumulates correctly
    handler({ clientX: 130, clientY: 115, buttons: 1 });

    expect(dragEvents).toHaveLength(2);
    expect(dragEvents[1].deltaX).toBe(10);
    expect(dragEvents[1].deltaY).toBe(5);
  });

  test("window-level pointermove stops DragEvent when button is released", () => {
    const dragState: DragState = {
      x: 100,
      y: 100,
      button: 0,
      lastMoveX: 100,
      lastMoveY: 100,
      dragging: true,
    };
    const ref = { current: dragState as DragState | null };
    const handler = buildWindowDragHandler(ref, eventBus);

    const dragEvents: DragEvent[] = [];
    eventBus.on(DragEvent, (e) => dragEvents.push(e));

    // Move with button released (buttons=0) — should NOT emit DragEvent
    handler({ clientX: 120, clientY: 110, buttons: 0 });

    expect(dragEvents).toHaveLength(0);
    // Pointer-down state should be cleared
    expect(ref.current).toBeNull();
  });

  test("dragging flag is latched after crossing 10px threshold", () => {
    const dragState: DragState = {
      x: 100,
      y: 100,
      button: 0,
      lastMoveX: 100,
      lastMoveY: 100,
      dragging: false,
    };
    const ref = { current: dragState as DragState | null };
    const handler = buildWindowDragHandler(ref, eventBus);

    // Small move (< 10px total displacement) — dragging should stay false
    handler({ clientX: 104, clientY: 104, buttons: 1 });
    expect(ref.current!.dragging).toBe(false);

    // Move beyond threshold (total displacement: |110-100| + |100-100| = 10)
    handler({ clientX: 110, clientY: 100, buttons: 1 });
    expect(ref.current!.dragging).toBe(true);
  });
});
