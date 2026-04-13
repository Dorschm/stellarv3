// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MouseUpEvent } from "../../src/client/InputHandler";
import { GameBridge } from "../../src/client/bridge/GameBridge";
import { useHUDStore } from "../../src/client/bridge/HUDStore";
import {
  collectReadyGates,
  destHighlightTiles,
  sourceHighlightTiles,
} from "../../src/client/scene/JumpGateHighlightRenderer";
import { resolveLeftClickAction } from "../../src/client/scene/jumpGateClickPrecedence";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";

// ---------------------------------------------------------------------------
// Minimal mocks
// ---------------------------------------------------------------------------

/** Stub UnitView with the fields collectReadyGates inspects. */
function makeGate(
  tile: TileRef,
  active = true,
  underConstruction = false,
): any {
  return {
    tile: () => tile,
    isActive: () => active,
    isUnderConstruction: () => underConstruction,
  };
}

/** Stub player with own gates and optional allies. */
function makePlayer(ownGates: any[], allies: any[] = []): any {
  return {
    units: (..._types: UnitType[]) => ownGates,
    allies: () => allies,
  };
}

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
// collectReadyGates – destination exclusion rules
// ---------------------------------------------------------------------------

describe("collectReadyGates: exclusion rules", () => {
  test("returns only active, non-construction gates", () => {
    const gates = [
      makeGate(10 as TileRef, true, false), // ready
      makeGate(20 as TileRef, false, false), // inactive — excluded
      makeGate(30 as TileRef, true, true), // under construction — excluded
      makeGate(40 as TileRef, true, false), // ready
    ];
    const player = makePlayer(gates);

    const result = collectReadyGates(player);
    expect(result).toHaveLength(2);
    expect(result[0].tile()).toBe(10);
    expect(result[1].tile()).toBe(40);
  });

  test("excludes enemy gates (only own + allied gates collected)", () => {
    // Own player has one gate
    const ownGates = [makeGate(10 as TileRef)];
    // Allied player has one gate
    const allyGates = [makeGate(20 as TileRef)];
    const ally = makePlayer(allyGates);
    const player = makePlayer(ownGates, [ally]);

    const result = collectReadyGates(player);
    // Only own + allied — enemy gates are never passed to collectReadyGates
    expect(result).toHaveLength(2);
    expect(result.map((g: any) => g.tile())).toEqual([10, 20]);
  });

  test("returns empty array when player is null", () => {
    expect(collectReadyGates(null)).toEqual([]);
  });

  test("excludes inactive allied gates", () => {
    const ownGates = [makeGate(10 as TileRef)];
    const allyGates = [
      makeGate(20 as TileRef, false, false), // inactive ally gate
      makeGate(30 as TileRef, true, true), // under-construction ally gate
    ];
    const ally = makePlayer(allyGates);
    const player = makePlayer(ownGates, [ally]);

    const result = collectReadyGates(player);
    expect(result).toHaveLength(1);
    expect(result[0].tile()).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// sourceHighlightTiles / destHighlightTiles – derivation
// ---------------------------------------------------------------------------

describe("highlight tile derivation", () => {
  test("sourceHighlightTiles returns all ready gate tiles", () => {
    const gates = [makeGate(10 as TileRef), makeGate(20 as TileRef)];
    const tiles = sourceHighlightTiles(gates);
    expect(tiles).toEqual([10, 20]);
  });

  test("destHighlightTiles excludes the source tile", () => {
    const gates = [
      makeGate(10 as TileRef),
      makeGate(20 as TileRef),
      makeGate(30 as TileRef),
    ];
    const result = destHighlightTiles(gates, 10 as TileRef);

    expect(result.source).toBe(10);
    expect(result.destinations).toEqual([20, 30]);
  });

  test("destHighlightTiles returns empty destinations for single gate", () => {
    const gates = [makeGate(10 as TileRef)];
    const result = destHighlightTiles(gates, 10 as TileRef);

    expect(result.source).toBe(10);
    expect(result.destinations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Click-routing precedence during gate mode
// ---------------------------------------------------------------------------

describe("click-routing precedence during gate mode", () => {
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
   * Simulate the gate-mode precedence check from SpaceMapPlane.onPointerUp:
   * when jumpGateMode !== "idle", a left-click emits MouseUpEvent and
   * returns early — no other click paths (build menu, emoji, context menu)
   * are reached.
   */
  function simulateLeftClick(
    bus: EventBus,
    tileX: number,
    tileY: number,
  ): { mouseUpEmitted: boolean } {
    const hudState = useHUDStore.getState();
    if (hudState.jumpGateMode !== "idle") {
      bus.emit(new MouseUpEvent(tileX, tileY, true));
      return { mouseUpEmitted: true };
    }
    return { mouseUpEmitted: false };
  }

  test("gate mode intercepts left-click before other handlers", () => {
    // Enter selectSource mode
    useHUDStore.getState().setJumpGateMode("selectSource");

    const mouseUpEvents: MouseUpEvent[] = [];
    eventBus.on(MouseUpEvent, (e) => mouseUpEvents.push(e));

    const result = simulateLeftClick(eventBus, 5, 5);

    expect(result.mouseUpEmitted).toBe(true);
    expect(mouseUpEvents).toHaveLength(1);
    expect(mouseUpEvents[0].x).toBe(5);
    expect(mouseUpEvents[0].y).toBe(5);
    expect(mouseUpEvents[0].isTileCoord).toBe(true);
  });

  test("gate mode intercepts during selectDest phase too", () => {
    useHUDStore.getState().setJumpGateMode("selectDest");
    useHUDStore.getState().setJumpGateSourceTile(10 as TileRef);

    const mouseUpEvents: MouseUpEvent[] = [];
    eventBus.on(MouseUpEvent, (e) => mouseUpEvents.push(e));

    const result = simulateLeftClick(eventBus, 7, 3);

    expect(result.mouseUpEmitted).toBe(true);
    expect(mouseUpEvents).toHaveLength(1);
  });

  test("idle mode does not intercept left-click", () => {
    // Default is idle
    expect(useHUDStore.getState().jumpGateMode).toBe("idle");

    const mouseUpEvents: MouseUpEvent[] = [];
    eventBus.on(MouseUpEvent, (e) => mouseUpEvents.push(e));

    const result = simulateLeftClick(eventBus, 5, 5);

    expect(result.mouseUpEmitted).toBe(false);
    expect(mouseUpEvents).toHaveLength(0);
  });

  test("right-click cancels gate mode and resets source tile", () => {
    // Enter selectDest mode with a source tile
    useHUDStore.getState().setJumpGateMode("selectDest");
    useHUDStore.getState().setJumpGateSourceTile(10 as TileRef);

    // Simulate the right-click gate-cancel logic from SpaceMapPlane.onContextMenu
    const hudState = useHUDStore.getState();
    if (hudState.jumpGateMode !== "idle") {
      hudState.setJumpGateMode("idle");
      hudState.setJumpGateSourceTile(null);
    }

    expect(useHUDStore.getState().jumpGateMode).toBe("idle");
    expect(useHUDStore.getState().jumpGateSourceTile).toBeNull();
  });

  test("Escape cancels gate mode via CloseViewEvent handler", () => {
    useHUDStore.getState().setJumpGateMode("selectSource");

    // Simulate ClientGameRunner.onCloseView
    const hs = useHUDStore.getState();
    if (hs.jumpGateMode !== "idle") {
      hs.setJumpGateMode("idle");
      hs.setJumpGateSourceTile(null);
    }

    expect(useHUDStore.getState().jumpGateMode).toBe("idle");
    expect(useHUDStore.getState().jumpGateSourceTile).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveLeftClickAction — exercises the actual precedence helper used by
// SpaceMapPlane.onPointerUp. Verifies that gate mode beats every other
// left-click shortcut path, and that the remaining fallback ordering is
// preserved when gate mode is idle.
// ---------------------------------------------------------------------------

describe("resolveLeftClickAction: precedence helper", () => {
  test("gate mode (selectSource) beats modifier + alt + leftClickOpensMenu", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "selectSource",
        modifierPressed: true,
        altPressed: true,
        leftClickOpensMenu: true,
        shiftKey: false,
      }),
    ).toBe("mouseUp");
  });

  test("gate mode (selectDest) beats every other shortcut", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "selectDest",
        modifierPressed: true,
        altPressed: false,
        leftClickOpensMenu: true,
        shiftKey: true,
      }),
    ).toBe("mouseUp");
  });

  test("idle + modifier pressed → buildMenu", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "idle",
        modifierPressed: true,
        altPressed: false,
        leftClickOpensMenu: false,
        shiftKey: false,
      }),
    ).toBe("buildMenu");
  });

  test("idle + alt pressed (no modifier) → emojiMenu", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "idle",
        modifierPressed: false,
        altPressed: true,
        leftClickOpensMenu: false,
        shiftKey: false,
      }),
    ).toBe("emojiMenu");
  });

  test("modifier takes priority over alt when both pressed", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "idle",
        modifierPressed: true,
        altPressed: true,
        leftClickOpensMenu: false,
        shiftKey: false,
      }),
    ).toBe("buildMenu");
  });

  test("idle + leftClickOpensMenu + no shift → contextMenu", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "idle",
        modifierPressed: false,
        altPressed: false,
        leftClickOpensMenu: true,
        shiftKey: false,
      }),
    ).toBe("contextMenu");
  });

  test("shift suppresses leftClickOpensMenu (falls through to mouseUp)", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "idle",
        modifierPressed: false,
        altPressed: false,
        leftClickOpensMenu: true,
        shiftKey: true,
      }),
    ).toBe("mouseUp");
  });

  test("idle + no modifiers + leftClickOpensMenu off → mouseUp", () => {
    expect(
      resolveLeftClickAction({
        jumpGateMode: "idle",
        modifierPressed: false,
        altPressed: false,
        leftClickOpensMenu: false,
        shiftKey: false,
      }),
    ).toBe("mouseUp");
  });
});
