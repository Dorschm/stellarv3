// @vitest-environment node
//
// Issue #7 — client HUD/build-menu regression: opening BuildMenu via the
// radial "Build on Capital Ship" entry must propagate the named cruiser id
// all the way through to the emitted `BuildUnitIntentEvent` so the server
// hosts on that exact cruiser with no proximity fallback.
//
// The test approach mirrors HostLobbyModal.test.tsx — node env with a
// hand-rolled React-hook harness so we can render `BuildMenu` without
// jsdom (which is currently incompatible with the project's Node
// toolchain).

import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- React-hook harness --------------------------------------------------
// Shared state across vi.mock factories and the test body. vi.hoisted makes
// the factory see the same object reference the test body mutates.
const harness = vi.hoisted(() => ({
  slots: [] as Array<{ value: unknown }>,
  idx: 0,
  effects: [] as Array<() => unknown>,
}));

function resetHarness() {
  harness.slots = [];
  harness.idx = 0;
  harness.effects = [];
}

function beginRender() {
  harness.idx = 0;
  harness.effects = [];
}

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(
      init: T | (() => T),
    ): [T, (v: T | ((prev: T) => T)) => void] => {
      const i = harness.idx++;
      if (!harness.slots[i]) {
        harness.slots[i] = {
          value: typeof init === "function" ? (init as () => T)() : init,
        };
      }
      const slot = harness.slots[i];
      const setter = (v: T | ((prev: T) => T)) => {
        slot.value =
          typeof v === "function" ? (v as (prev: T) => T)(slot.value as T) : v;
      };
      return [slot.value as T, setter];
    },
    useRef: <T,>(init: T): { current: T } => {
      const i = harness.idx++;
      if (!harness.slots[i]) {
        harness.slots[i] = { value: { current: init } };
      }
      return harness.slots[i].value as { current: T };
    },
    useMemo: <T,>(fn: () => T): T => {
      const i = harness.idx++;
      if (!harness.slots[i]) {
        harness.slots[i] = { value: fn() };
      }
      return harness.slots[i].value as T;
    },
    useCallback: <T,>(fn: T): T => fn,
    useEffect: (fn: () => unknown) => {
      harness.effects.push(fn);
    },
  };
});

// ---- Module mocks --------------------------------------------------------
// The mocks expose just enough surface for BuildMenu to walk through a
// capital-ship build click without touching real game state. The HUDStore
// mock returns a plain object that `useHUDStore.getState()` interrogates
// only for the rocket-direction flag, which doesn't matter for this test
// (we exercise a hostable structure, not a missile).

const mocks = vi.hoisted(
  () =>
    ({
      buildables: vi.fn(),
      isUnitDisabled: vi.fn(),
      hostableStructures: vi.fn(),
      isValidCoord: vi.fn(),
      ref: vi.fn(),
      myPlayerIsAlive: true,
      emittedIntents: [] as any[],
      eventBusListeners: new Map<any, Array<(e: any) => void>>(),
      gameViewContext: null as any,
      useGameTickReturn: null as any,
    }) as {
      buildables: ReturnType<typeof vi.fn>;
      isUnitDisabled: ReturnType<typeof vi.fn>;
      hostableStructures: ReturnType<typeof vi.fn>;
      isValidCoord: ReturnType<typeof vi.fn>;
      ref: ReturnType<typeof vi.fn>;
      myPlayerIsAlive: boolean;
      emittedIntents: any[];
      eventBusListeners: Map<any, Array<(e: any) => void>>;
      gameViewContext: any;
      useGameTickReturn: any;
    },
);

vi.mock("../../../src/client/bridge/GameViewContext", () => {
  return {
    useGameView: () => mocks.gameViewContext,
  };
});

vi.mock("../../../src/client/bridge/useEventBus", () => {
  return {
    useEventBus: (
      _bus: unknown,
      eventType: any,
      callback: (e: any) => void,
    ) => {
      const existing = mocks.eventBusListeners.get(eventType) ?? [];
      existing.push(callback);
      mocks.eventBusListeners.set(eventType, existing);
    },
  };
});

vi.mock("../../../src/client/bridge/HUDStore", () => ({
  useHUDStore: Object.assign(() => undefined, {
    getState: () => ({ rocketDirectionUp: true }),
  }),
}));

vi.mock("../../../src/client/Utils", () => ({
  renderNumber: (n: bigint | number) => String(n),
  translateText: (key: string) => key,
}));

vi.mock("../../../src/core/AssetUrls", () => ({
  assetUrl: (p: string) => p,
}));

import { useGameTick } from "../../../src/client/hud/useGameTick";

vi.mock("../../../src/client/hud/useGameTick", () => ({
  useGameTick: () => mocks.useGameTickReturn,
}));

import { ShowBuildMenuEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

// Imported AFTER mocks so BuildMenu picks up the fakes.
const { BuildMenu } = await import("../../../src/client/hud/BuildMenu");

mocks.gameViewContext = null; // populated per-test
mocks.useGameTickReturn = null; // populated per-test

const CRUISER_TILE = 1234;
const HOST_CRUISER_ID = 9999;

function setupFakes() {
  const realBus = new EventBus();
  realBus.on(BuildUnitIntentEvent, (e) => mocks.emittedIntents.push(e));

  // EventBus mock replacement that funnels emits through `realBus` so the
  // BuildUnitIntentEvent listener above captures them — but route `.on`
  // calls through our useEventBus mock so we can manually trigger
  // ShowBuildMenuEvent without an actual React subscription.
  const fakeBus = {
    emit: (e: any) => realBus.emit(e),
    on: (eventType: any, cb: (e: any) => void) => {
      const existing = mocks.eventBusListeners.get(eventType) ?? [];
      existing.push(cb);
      mocks.eventBusListeners.set(eventType, existing);
    },
    off: () => {},
  };

  const fakeGameView = {
    myPlayer: () => ({
      isAlive: () => mocks.myPlayerIsAlive,
      buildables: mocks.buildables,
      totalUnitLevels: () => 0,
      credits: () => 1_000_000n,
    }),
    config: () => ({
      isUnitDisabled: mocks.isUnitDisabled,
      battlecruiserHostableStructures: mocks.hostableStructures,
      scoutSwarmCostFraction: () => 0,
    }),
    isValidCoord: mocks.isValidCoord,
    ref: mocks.ref,
  };

  mocks.gameViewContext = {
    gameView: fakeGameView,
    eventBus: fakeBus,
  };
  mocks.useGameTickReturn = {
    gameView: fakeGameView,
    eventBus: fakeBus,
    tick: 0,
  };
}

function fireShowBuildMenu(event: ShowBuildMenuEvent) {
  const listeners = mocks.eventBusListeners.get(ShowBuildMenuEvent) ?? [];
  for (const cb of listeners) cb(event);
}

// Walk the rendered React tree, invoking any function components we hit so
// the result is a tree of host elements ("button", "div", etc.). Mirrors
// the HostLobbyModal harness.
type RenderedNode =
  | null
  | undefined
  | string
  | number
  | boolean
  | RenderedNode[]
  | {
      type: string | ((props: Record<string, unknown>) => RenderedNode);
      props: Record<string, unknown> & { children?: RenderedNode };
      [key: string]: unknown;
    };

function renderTree(node: RenderedNode): RenderedNode {
  if (node === null || node === undefined || typeof node !== "object")
    return node;
  if (Array.isArray(node)) return node.map(renderTree);
  const el = node as Exclude<
    RenderedNode,
    null | undefined | string | number | boolean | RenderedNode[]
  >;
  if (typeof el.type === "function") {
    const result = el.type(el.props ?? {});
    return renderTree(result as RenderedNode);
  }
  const newProps = { ...el.props };
  if ("children" in newProps) {
    newProps.children = renderTree(newProps.children);
  }
  return { ...el, props: newProps } as RenderedNode;
}

function* walk(node: RenderedNode): Generator<any> {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) yield* walk(c);
    return;
  }
  yield node;
  const children = (node as any).props?.children;
  if (children !== null && children !== undefined) yield* walk(children);
}

function findButtonForType(
  tree: RenderedNode,
  unitType: UnitType,
): { props: Record<string, any> } {
  for (const el of walk(tree)) {
    if (
      el.type === "button" &&
      typeof el.key === "string" &&
      el.key === unitType
    ) {
      return el;
    }
  }
  // The vi-mocked React doesn't surface React `key`s on the element, so
  // fall back to scanning the inner content for the unit-type token.
  for (const el of walk(tree)) {
    if (el.type === "button") {
      const json = JSON.stringify(el);
      if (json.includes(String(unitType))) return el;
    }
  }
  throw new Error(`No build button for ${unitType}`);
}

async function flushAsync() {
  for (let i = 0; i < 8; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("BuildMenu — capital-ship host id propagation (Issue #7)", () => {
  beforeEach(() => {
    resetHarness();
    mocks.emittedIntents = [];
    mocks.eventBusListeners = new Map();
    mocks.myPlayerIsAlive = true;

    mocks.buildables.mockReset();
    mocks.isUnitDisabled.mockReset().mockReturnValue(false);
    mocks.hostableStructures
      .mockReset()
      .mockReturnValue([
        UnitType.Spaceport,
        UnitType.OrbitalStrikePlatform,
        UnitType.DefenseStation,
        UnitType.PointDefenseArray,
        UnitType.Colony,
        UnitType.Foundry,
        UnitType.JumpGate,
      ]);
    mocks.isValidCoord.mockReset().mockReturnValue(true);
    mocks.ref.mockReset().mockImplementation(() => CRUISER_TILE);

    setupFakes();
  });

  afterEach(() => {
    resetHarness();
  });

  test("hostable build via radial capital-ship flow emits BuildUnitIntentEvent with hostBattlecruiserId", async () => {
    // First render — subscribes listeners (useEventBus) and registers
    // refresh useEffect. BuildMenu is hidden by default and returns null.
    beginRender();
    const empty = renderTree(
      React.createElement(BuildMenu) as unknown as RenderedNode,
    );
    expect(empty).toBeNull();

    // Simulate the radial menu firing the capital-ship ShowBuildMenuEvent
    // with the explicit cruiser id named in handleBuildOnCapitalShip.
    fireShowBuildMenu(new ShowBuildMenuEvent(0, 0, true, HOST_CRUISER_ID));

    // Stub the buildables() resolution — once for Colony so we can click it.
    mocks.buildables.mockResolvedValue([
      {
        type: UnitType.Colony,
        canBuild: CRUISER_TILE,
        canUpgrade: false,
        cost: 1000n,
      },
    ]);

    // Second render — picks up the new state (hidden=false, capitalShipMode
    // =true, hostBattlecruiserId=HOST_CRUISER_ID, clickedTile=CRUISER_TILE).
    beginRender();
    let tree = renderTree(
      React.createElement(BuildMenu) as unknown as RenderedNode,
    );

    // Trigger the refresh useEffect so playerBuildables populates.
    for (const eff of harness.effects) {
      await (eff as () => Promise<unknown> | unknown)();
    }
    await flushAsync();

    // Third render — `playerBuildables` is now set, so a Colony button
    // exists in the rendered tree.
    beginRender();
    tree = renderTree(
      React.createElement(BuildMenu) as unknown as RenderedNode,
    );

    const colonyBtn = findButtonForType(tree, UnitType.Colony);
    expect(typeof colonyBtn.props.onClick).toBe("function");
    (colonyBtn.props.onClick as () => void)();

    expect(mocks.emittedIntents).toHaveLength(1);
    const intent = mocks.emittedIntents[0] as BuildUnitIntentEvent;
    expect(intent.unit).toBe(UnitType.Colony);
    // The explicit cruiser id must be threaded through the intent so the
    // server's host-only branch in ConstructionExecution hosts on this
    // exact cruiser with no proximity fallback.
    expect(intent.hostBattlecruiserId).toBe(HOST_CRUISER_ID);
  });

  test("ordinary ground build (capital-ship mode off) emits intent WITHOUT hostBattlecruiserId", async () => {
    beginRender();
    renderTree(React.createElement(BuildMenu) as unknown as RenderedNode);

    // Plain ShowBuildMenuEvent — no capital-ship flag, no cruiser id.
    fireShowBuildMenu(new ShowBuildMenuEvent(0, 0));

    mocks.buildables.mockResolvedValue([
      {
        type: UnitType.Colony,
        canBuild: CRUISER_TILE,
        canUpgrade: false,
        cost: 1000n,
      },
    ]);

    beginRender();
    renderTree(React.createElement(BuildMenu) as unknown as RenderedNode);
    for (const eff of harness.effects) {
      await (eff as () => Promise<unknown> | unknown)();
    }
    await flushAsync();

    beginRender();
    const tree = renderTree(
      React.createElement(BuildMenu) as unknown as RenderedNode,
    );

    const colonyBtn = findButtonForType(tree, UnitType.Colony);
    (colonyBtn.props.onClick as () => void)();

    expect(mocks.emittedIntents).toHaveLength(1);
    const intent = mocks.emittedIntents[0] as BuildUnitIntentEvent;
    expect(intent.unit).toBe(UnitType.Colony);
    // Ordinary ground path: the server takes the regular construction
    // route, no host id forwarded.
    expect(intent.hostBattlecruiserId).toBeUndefined();
  });
});

// Reference the useGameTick import so TS doesn't drop it before vi.mock
// has a chance to swap it out (the actual mock takes effect via the
// hoisted vi.mock call above).
void useGameTick;
