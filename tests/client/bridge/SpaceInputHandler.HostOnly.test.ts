// @vitest-environment node
//
// Why a node env with a hand-rolled window stub instead of jsdom: the
// project's jsdom environment is currently incompatible with its Node
// toolchain (html-encoding-sniffer requires `@exodus/bytes` as CJS while
// that package ships ESM-only). The HostLobbyModal test takes the same
// approach.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// -- Minimal globals SpaceInputHandler.initialize() reaches for ----------
// localStorage (for `settings.keybinds`), CustomEvent, KeyboardEvent, and
// a window with addEventListener/dispatchEvent. SpaceInputHandler also
// uses `setInterval` for the pan/zoom movement loop — node provides that
// natively, so we leave it alone.

class FakeEventTarget {
  private listeners = new Map<string, Set<(e: any) => void>>();
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(event: { type: string }): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const fn of set) fn(event);
    return true;
  }
}

class FakeKeyboardEvent {
  type: string;
  code: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: any;
  constructor(type: string, init: any = {}) {
    this.type = type;
    this.code = init.code ?? "";
    this.repeat = init.repeat ?? false;
    this.altKey = init.altKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.target = init.target ?? null;
  }
  preventDefault(): void {}
}

class FakeCustomEvent<T = any> {
  type: string;
  detail: T;
  constructor(type: string, init: { detail: T }) {
    this.type = type;
    this.detail = init.detail;
  }
}

const fakeWindow = new FakeEventTarget() as unknown as Window;
(fakeWindow as any).innerWidth = 1024;
(fakeWindow as any).innerHeight = 768;

(globalThis as any).window = fakeWindow;
(globalThis as any).KeyboardEvent = FakeKeyboardEvent as any;
(globalThis as any).CustomEvent = FakeCustomEvent as any;
(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
// `translateText` reaches for `document.querySelector("lang-selector")` to
// pick the active locale. We don't care which locale runs in this test —
// just that *some* string comes back — so stub a document with a no-op
// querySelector. The translation falls back to the literal key when no
// selector element is found, which is what we assert against.
(globalThis as any).document = {
  querySelector: () => null,
};

// Imports after the globals are defined so the modules' top-level reads
// (Platform.isMac, etc.) see the stubs.
import {
  PlayerSnapshot,
  UnitSnapshot,
  useHUDStore,
} from "../../../src/client/bridge/HUDStore";
import { SpaceInputHandler } from "../../../src/client/bridge/SpaceInputHandler";
import { GhostStructureChangedEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { PlayerType, UnitType } from "../../../src/core/game/Game";

/**
 * Issue #7 — verify the selected-cruiser hotkey path in SpaceInputHandler
 * dispatches a "Not enough money" rejection toast when the player cannot
 * afford the hosted structure, instead of silently bouncing on the server
 * (its previous behavior — see the verification comment on issue #7).
 */

const CRUISER_ID = 7777;
const MY_SMALL_ID = 1;
const COST = 100n;

function makeMyPlayer(credits: bigint): PlayerSnapshot {
  return {
    id: "pilot",
    smallID: MY_SMALL_ID,
    name: "pilot",
    displayName: "pilot",
    isAlive: true,
    population: 0,
    credits,
    numTilesOwned: 0,
    allies: [],
    isMe: true,
    playerType: PlayerType.Human,
    team: null,
  };
}

function makeCruiser(opts: { occupied: boolean }): UnitSnapshot {
  return {
    id: CRUISER_ID,
    type: UnitType.Battlecruiser,
    ownerSmallID: MY_SMALL_ID,
    tile: 1234,
    population: 0,
    level: 0,
    isActive: true,
    health: undefined,
    hasSlottedStructure: opts.occupied,
  };
}

function preloadHUD(opts: {
  credits: bigint;
  cost: bigint | undefined;
  occupied?: boolean;
}) {
  const hud = useHUDStore.getState();
  hud.reset();
  hud.setMyPlayer(makeMyPlayer(opts.credits));
  const units = new Map<number, UnitSnapshot>();
  units.set(CRUISER_ID, makeCruiser({ occupied: opts.occupied === true }));
  hud.setUnits(units);
  hud.setSelectedBattlecruiser(CRUISER_ID);
  const costs = new Map<UnitType, bigint>();
  if (opts.cost !== undefined) {
    costs.set(UnitType.Colony, opts.cost);
  }
  hud.setCruiserHostableCosts(costs);
}

describe("SpaceInputHandler — selected-cruiser host-only hotkey feedback", () => {
  let bus: EventBus;
  let handler: SpaceInputHandler;
  let toastSpy: ReturnType<typeof vi.fn>;
  let buildIntents: BuildUnitIntentEvent[];
  let ghostChanges: (UnitType | null)[];

  beforeEach(() => {
    bus = new EventBus();
    handler = new SpaceInputHandler(bus);
    handler.initialize();

    buildIntents = [];
    ghostChanges = [];
    bus.on(BuildUnitIntentEvent, (e) => buildIntents.push(e));
    bus.on(GhostStructureChangedEvent, (e) =>
      ghostChanges.push(e.ghostStructure),
    );

    toastSpy = vi.fn();
    (window as any).addEventListener("show-message", toastSpy);
  });

  afterEach(() => {
    handler.destroy();
    (window as any).removeEventListener("show-message", toastSpy);
    useHUDStore.getState().reset();
  });

  function pressDigit1() {
    (window as any).dispatchEvent(
      new (globalThis as any).KeyboardEvent("keyup", { code: "Digit1" }),
    );
  }

  test("insufficient credits dispatches a rejection toast and skips ghost fallback", () => {
    preloadHUD({ credits: 1n, cost: COST });
    pressDigit1();

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const evt = toastSpy.mock.calls[0][0] as any;
    expect(evt.detail.color).toBe("red");
    expect(typeof evt.detail.message).toBe("string");
    expect(evt.detail.message.length).toBeGreaterThan(0);

    expect(buildIntents).toHaveLength(0);
    expect(ghostChanges).toHaveLength(0);
  });

  test("sufficient credits emits the host-only BuildUnitIntent and no toast", () => {
    preloadHUD({ credits: COST, cost: COST });
    pressDigit1();

    expect(toastSpy).toHaveBeenCalledTimes(0);
    expect(buildIntents).toHaveLength(1);
    expect(buildIntents[0].unit).toBe(UnitType.Colony);
    expect((buildIntents[0] as any).hostBattlecruiserId).toBe(CRUISER_ID);
    expect(ghostChanges).toHaveLength(0);
  });

  test("full slot still wins over affordability (Slot occupied toast)", () => {
    preloadHUD({ credits: 1n, cost: COST, occupied: true });
    pressDigit1();

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const msg = (toastSpy.mock.calls[0][0] as any).detail.message;
    expect(String(msg)).toMatch(/slot/i);
    expect(buildIntents).toHaveLength(0);
    expect(ghostChanges).toHaveLength(0);
  });
});

/**
 * Issue #4 — Escape precedence: when a Capital Ship is selected AND a
 * ghost build is armed, the first Escape must only clear the selection
 * and leave the ghost intact. The verification comment specifically
 * asked for a test that drives `SpaceInputHandler` directly (rather
 * than re-stating the branch in the test body) so the production code
 * path is the contract under test.
 */
describe("SpaceInputHandler — Escape precedence (Issue #4)", () => {
  let bus: EventBus;
  let handler: SpaceInputHandler;
  let buildIntents: BuildUnitIntentEvent[];
  let ghostChanges: (UnitType | null)[];

  beforeEach(() => {
    bus = new EventBus();
    handler = new SpaceInputHandler(bus);
    handler.initialize();

    buildIntents = [];
    ghostChanges = [];
    bus.on(BuildUnitIntentEvent, (e) => buildIntents.push(e));
    bus.on(GhostStructureChangedEvent, (e) =>
      ghostChanges.push(e.ghostStructure),
    );
    useHUDStore.getState().reset();
  });

  afterEach(() => {
    handler.destroy();
    useHUDStore.getState().reset();
  });

  function pressEscape() {
    (window as any).dispatchEvent(
      new (globalThis as any).KeyboardEvent("keydown", { code: "Escape" }),
    );
  }

  test("Escape with both cruiser selection AND ghost armed clears only the selection (no ghost change)", () => {
    const hud = useHUDStore.getState();
    hud.setMyPlayer(makeMyPlayer(1_000_000n));
    hud.setUnits(
      new Map<number, UnitSnapshot>([
        [CRUISER_ID, makeCruiser({ occupied: false })],
      ]),
    );
    hud.setSelectedBattlecruiser(CRUISER_ID);
    hud.setGhostStructure(UnitType.Colony);

    // Read through `useHUDStore.getState()` on every assertion: the
    // snapshot returned by `getState()` is a frozen view, not a live
    // proxy, so values captured before the setters fire are stale.
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBe(CRUISER_ID);
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.Colony);

    pressEscape();

    // First Escape: selection cleared, ghost preserved, no ghost-change
    // event emitted.
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBeNull();
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.Colony);
    expect(ghostChanges).toHaveLength(0);
    expect(buildIntents).toHaveLength(0);
  });

  test("Escape with only ghost armed clears the ghost on the first press", () => {
    useHUDStore.getState().setGhostStructure(UnitType.Colony);
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.Colony);

    pressEscape();

    // No cruiser selection -> ghost-clear path runs.
    expect(ghostChanges).toHaveLength(1);
    expect(ghostChanges[0]).toBeNull();
  });

  test("second Escape after the selection clears falls through to the ghost-clear path", () => {
    const hud0 = useHUDStore.getState();
    hud0.setMyPlayer(makeMyPlayer(1_000_000n));
    hud0.setUnits(
      new Map<number, UnitSnapshot>([
        [CRUISER_ID, makeCruiser({ occupied: false })],
      ]),
    );
    hud0.setSelectedBattlecruiser(CRUISER_ID);
    hud0.setGhostStructure(UnitType.Colony);

    pressEscape();
    // First Escape cleared the selection but left the ghost armed.
    expect(useHUDStore.getState().selectedBattlecruiserUnitId).toBeNull();
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.Colony);
    expect(ghostChanges).toHaveLength(0);

    pressEscape();
    // Second Escape with no selection but ghost still armed runs the
    // ghost-clear path.
    expect(ghostChanges).toHaveLength(1);
    expect(ghostChanges[0]).toBeNull();
  });
});
