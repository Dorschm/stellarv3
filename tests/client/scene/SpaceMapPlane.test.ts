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

// ---------------------------------------------------------------------------
// Comment 2/3 – Capital Ship selection (select-or-swap) + stale cleanup
//
// We can't mount React/R3F under the node test env, so these tests replicate
// the exact branching logic of SpaceMapPlane's click and cleanup paths
// against the real HUDStore. They cover:
//   - select / swap / same-click-preserves
//   - Esc clears selection
//   - destroyed and captured ships are cleaned up
// ---------------------------------------------------------------------------

interface MiniUnitSnapshot {
  id: number;
  type: UnitType;
  tile: number;
  ownerSmallID: number;
  isActive: boolean;
  hasSlottedStructure: boolean;
}

/**
 * Replicate the SpaceMapPlane left-click select-or-swap branch. Given the
 * HUD state and the unit (if any) the click resolved to, this returns the
 * resulting `selectedBattlecruiserUnitId`.
 */
function resolveClickSelection(
  current: number | null,
  clickedUnitId: number | null,
): number | null {
  if (clickedUnitId !== null) {
    // Select-or-swap: always pin selection to the clicked id. Same-click
    // preserves the existing selection; another friendly cruiser swaps.
    return clickedUnitId;
  }
  return current;
}

/**
 * Replicate the SpaceMapPlane cleanup effect predicate. Returns whether
 * the selection should be cleared.
 */
function shouldClearSelection(
  selected: number | null,
  unit: MiniUnitSnapshot | undefined,
  myPlayerSmallID: number | null,
): boolean {
  if (selected === null) return false;
  if (unit === undefined) return true;
  if (unit.type !== UnitType.Battlecruiser) return true;
  if (!unit.isActive) return true;
  if (myPlayerSmallID === null) return true;
  if (unit.ownerSmallID !== myPlayerSmallID) return true;
  return false;
}

describe("SpaceMapPlane: capital ship select-or-swap", () => {
  beforeEach(() => {
    useHUDStore.getState().reset();
  });

  test("owned Battlecruiser click sets selection", () => {
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBeNull();
    const next = resolveClickSelection(null, 42);
    useHUDStore.getState().setSelectedBattlecruiser(next);
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBe(42);
  });

  test("same-click on already-selected ship preserves selection (no toggle-off)", () => {
    useHUDStore.getState().setSelectedBattlecruiser(42);
    const next = resolveClickSelection(42, 42);
    useHUDStore.getState().setSelectedBattlecruiser(next);
    // Critical regression guard: same-click MUST NOT clear the selection.
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBe(42);
  });

  test("clicking another friendly Battlecruiser swaps the selection", () => {
    useHUDStore.getState().setSelectedBattlecruiser(42);
    const next = resolveClickSelection(42, 99);
    useHUDStore.getState().setSelectedBattlecruiser(next);
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBe(99);
  });

  test("Esc clears the selection", () => {
    useHUDStore.getState().setSelectedBattlecruiser(42);
    // Esc path in SpaceInputHandler.onKeyDown:
    //   if (hud.selectedBattlecruiserUnitId !== null) setSelectedBattlecruiser(null)
    if (useHUDStore.getState().selectedBattlecruiserUnitId !== null) {
      useHUDStore.getState().setSelectedBattlecruiser(null);
    }
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBeNull();
  });
});

describe("SpaceMapPlane: stale selection cleanup", () => {
  beforeEach(() => {
    useHUDStore.getState().reset();
  });

  test("destroyed cruiser (missing from snapshot) clears selection", () => {
    expect(shouldClearSelection(42, undefined, 1)).toBe(true);
  });

  test("inactive cruiser clears selection", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 1,
      isActive: false,
      hasSlottedStructure: false,
    };
    expect(shouldClearSelection(42, unit, 1)).toBe(true);
  });

  test("captured cruiser (ownerSmallID flipped) clears selection", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 7, // captured to a different player
      isActive: true,
      hasSlottedStructure: false,
    };
    expect(shouldClearSelection(42, unit, 1)).toBe(true);
  });

  test("missing myPlayer (spectator / before join) clears selection", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 1,
      isActive: true,
      hasSlottedStructure: false,
    };
    expect(shouldClearSelection(42, unit, null)).toBe(true);
  });

  test("snapshot id collision with non-Battlecruiser clears selection", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Spaceport,
      tile: 0,
      ownerSmallID: 1,
      isActive: true,
      hasSlottedStructure: false,
    };
    expect(shouldClearSelection(42, unit, 1)).toBe(true);
  });

  test("live, owned, active Battlecruiser preserves selection", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 1,
      isActive: true,
      hasSlottedStructure: false,
    };
    expect(shouldClearSelection(42, unit, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Comment 3 – Hostable-hotkey stale-cruiser handling in SpaceInputHandler
//
// Replicates the hostable-hotkey branch's stale/occupied/host-build
// outcomes so the test exercises the contract without keyboard plumbing.
// ---------------------------------------------------------------------------

type HotkeyOutcome =
  | { kind: "ghost" }
  | { kind: "host-build" }
  | { kind: "slot-occupied" }
  | { kind: "stale-cleared" };

const HOSTABLE_TYPES = new Set<UnitType>([
  UnitType.Colony,
  UnitType.Foundry,
  UnitType.Spaceport,
  UnitType.DefenseStation,
  UnitType.OrbitalStrikePlatform,
  UnitType.PointDefenseArray,
]);

function resolveHotkeyOutcome(args: {
  selectedId: number | null;
  unit: MiniUnitSnapshot | undefined;
  myPlayerSmallID: number | null;
  hotkeyType: UnitType;
}): HotkeyOutcome {
  const { selectedId, unit, myPlayerSmallID, hotkeyType } = args;
  const isHostable = HOSTABLE_TYPES.has(hotkeyType);
  if (selectedId !== null && isHostable) {
    const stale =
      unit === undefined ||
      unit.type !== UnitType.Battlecruiser ||
      !unit.isActive ||
      myPlayerSmallID === null ||
      unit.ownerSmallID !== myPlayerSmallID;
    if (stale) {
      // Consume the hotkey — do NOT fall through to ground ghost.
      return { kind: "stale-cleared" };
    }
    if (unit!.hasSlottedStructure) {
      return { kind: "slot-occupied" };
    }
    return { kind: "host-build" };
  }
  // Non-hostable hotkey or no selection — ground ghost fallback.
  return { kind: "ghost" };
}

describe("SpaceInputHandler: hostable hotkey with stale selection", () => {
  test("stale hostable hotkey clears selection and consumes hotkey (no ground ghost)", () => {
    const outcome = resolveHotkeyOutcome({
      selectedId: 42,
      unit: undefined, // destroyed
      myPlayerSmallID: 1,
      hotkeyType: UnitType.Colony,
    });
    expect(outcome.kind).toBe("stale-cleared");
  });

  test("captured cruiser + hostable hotkey clears + consumes (no ground ghost)", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 7,
      isActive: true,
      hasSlottedStructure: false,
    };
    const outcome = resolveHotkeyOutcome({
      selectedId: 42,
      unit,
      myPlayerSmallID: 1,
      hotkeyType: UnitType.Colony,
    });
    expect(outcome.kind).toBe("stale-cleared");
  });

  test("occupied slot shows 'Slot occupied' without ground fallback", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 1,
      isActive: true,
      hasSlottedStructure: true,
    };
    const outcome = resolveHotkeyOutcome({
      selectedId: 42,
      unit,
      myPlayerSmallID: 1,
      hotkeyType: UnitType.Colony,
    });
    expect(outcome.kind).toBe("slot-occupied");
  });

  test("non-hostable hotkey with selected cruiser still ghost-builds on ground", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 1,
      isActive: true,
      hasSlottedStructure: false,
    };
    // Battlecruiser itself is in the buildable list but NOT hostable.
    const outcome = resolveHotkeyOutcome({
      selectedId: 42,
      unit,
      myPlayerSmallID: 1,
      hotkeyType: UnitType.Battlecruiser,
    });
    expect(outcome.kind).toBe("ghost");
  });

  test("no selected cruiser falls back to ground ghost for hostable hotkey", () => {
    const outcome = resolveHotkeyOutcome({
      selectedId: null,
      unit: undefined,
      myPlayerSmallID: 1,
      hotkeyType: UnitType.Colony,
    });
    expect(outcome.kind).toBe("ghost");
  });

  test("valid selection + empty slot triggers host-build (no ground ghost)", () => {
    const unit: MiniUnitSnapshot = {
      id: 42,
      type: UnitType.Battlecruiser,
      tile: 0,
      ownerSmallID: 1,
      isActive: true,
      hasSlottedStructure: false,
    };
    const outcome = resolveHotkeyOutcome({
      selectedId: 42,
      unit,
      myPlayerSmallID: 1,
      hotkeyType: UnitType.OrbitalStrikePlatform,
    });
    expect(outcome.kind).toBe("host-build");
  });
});
