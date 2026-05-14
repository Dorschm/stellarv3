// @vitest-environment node
//
// Issue #7 — verify GameBridge.tick() populates `cruiserHostableCosts` from
// the cost function via the new typed PlayerView adapter (no `as any`), and
// that the populated cost map is what makes SpaceInputHandler dispatch the
// "Not enough money" toast on a selected-cruiser hotkey press without
// emitting a BuildUnitIntentEvent.
//
// Why a node env with hand-rolled window/keyboard stubs: matches the sibling
// SpaceInputHandler.HostOnly test — jsdom is incompatible with the project's
// Node toolchain.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
(globalThis as any).document = {
  querySelector: () => null,
};

import { GameBridge } from "../../../src/client/bridge/GameBridge";
import { useHUDStore } from "../../../src/client/bridge/HUDStore";
import { SpaceInputHandler } from "../../../src/client/bridge/SpaceInputHandler";
import { GhostStructureChangedEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { PlayerType, UnitType } from "../../../src/core/game/Game";

const MY_ID = "pilot";
const MY_SMALL_ID = 1;
const MY_CLIENT_ID = "client-1";
const CRUISER_ID = 4242;
const CRUISER_TILE = 1234;

/**
 * Cost ladder used by the mock unitInfo for `UnitType.Colony`. Mirrors
 * `DefaultConfig.unitInfo(Colony).cost` (exponential 125k * 2^numUnits up to
 * 1M) so the test exercises the same shape the real game uses.
 */
function colonyCost(numUnits: number): bigint {
  return BigInt(Math.min(1_000_000, Math.pow(2, numUnits) * 125_000));
}

/**
 * Build a minimal PlayerView-shaped object exposing only the methods the
 * GameBridge cost-population path reads: `id`, `smallID`, `name`,
 * `displayName`, `isAlive`, `population`, `credits`, `numTilesOwned`,
 * `allies`, `type`, `team`, and `units(type)`. Each unit exposes
 * `level()` and `isUnderConstruction()`.
 */
function makePlayerLike(opts: { credits: bigint; ownedColonies: number }): any {
  const colonies = Array.from({ length: opts.ownedColonies }, () => ({
    level: () => 1,
    isUnderConstruction: () => false,
  }));
  return {
    id: () => MY_ID,
    smallID: () => MY_SMALL_ID,
    name: () => "pilot",
    displayName: () => "pilot",
    isAlive: () => true,
    population: () => 0,
    credits: () => opts.credits,
    numTilesOwned: () => 0,
    allies: () => [],
    type: () => PlayerType.Human,
    team: () => null,
    units: (type: UnitType) => (type === UnitType.Colony ? colonies : []),
  };
}

/**
 * Build a GameView mock that GameBridge.tick() consumes. Returns the
 * supplied player-like object from `myPlayer()` and `players()`. The
 * `unitInfo(type).cost` function mirrors `DefaultConfig.costWrapper` —
 * it asserts the adapter exposes the expected method shape (which catches
 * regressions where someone re-introduces an `as any` cast that hides
 * missing methods) and applies the Colony ladder.
 */
function makeMockGameView(playerLike: any): any {
  const cruiserUnit = {
    id: () => CRUISER_ID,
    type: () => UnitType.Battlecruiser,
    owner: () => playerLike,
    tile: () => CRUISER_TILE,
    population: () => 0,
    level: () => 0,
    isActive: () => true,
    hasHealth: () => false,
    health: () => 0,
    hasSlottedStructure: () => false,
  };
  return {
    ticks: () => 0,
    inSpawnPhase: () => false,
    players: () => [playerLike],
    myPlayer: () => playerLike,
    units: () => [cruiserUnit],
    updatesSinceLastTick: () => null,
    config: () => ({
      battlecruiserHostableStructures: () => [UnitType.Colony],
    }),
    unitInfo: (type: UnitType) => {
      if (type !== UnitType.Colony) {
        throw new Error(`unexpected unitInfo lookup for ${type}`);
      }
      return {
        cost: (_g: unknown, p: any): bigint => {
          // Adapter-shape assertions: GameBridge must pass an object that
          // exposes the narrow Player subset costWrapper actually reads.
          // If someone re-introduces an `as any` smuggling a PlayerView
          // (which has neither method), these throws surface immediately.
          if (typeof p?.type !== "function") {
            throw new Error("cost: adapter is missing type()");
          }
          if (typeof p?.unitsOwned !== "function") {
            throw new Error("cost: adapter is missing unitsOwned()");
          }
          if (typeof p?.unitsConstructed !== "function") {
            throw new Error("cost: adapter is missing unitsConstructed()");
          }
          if (
            p.type() === PlayerType.Human &&
            (false as boolean) /* infiniteCredits off in this test */
          ) {
            return 0n;
          }
          const numUnits = Math.min(
            p.unitsOwned(UnitType.Colony),
            p.unitsConstructed(UnitType.Colony),
          );
          return colonyCost(numUnits);
        },
      };
    },
  };
}

describe("GameBridge cruiserHostableCosts (issue #7)", () => {
  beforeEach(() => {
    useHUDStore.getState().reset();
  });

  test("tick() populates cruiserHostableCosts via the typed cost adapter", () => {
    const playerLike = makePlayerLike({
      credits: 50_000n,
      ownedColonies: 0,
    });
    const bridge = new GameBridge(makeMockGameView(playerLike), MY_CLIENT_ID);
    bridge.initialize(new EventBus());

    bridge.tick();

    const costs = useHUDStore.getState().cruiserHostableCosts;
    expect(costs.size).toBe(1);
    expect(costs.get(UnitType.Colony)).toBe(colonyCost(0));
    bridge.destroy();
  });

  test("captured/extant units do NOT inflate client cost (conservative adapter)", () => {
    // Player has 2 Colonies visible in PlayerView (e.g., one built + one
    // captured, or both captured). Authoritative server `unitsConstructed`
    // is unknown to the client, so the adapter conservatively returns 0
    // for both unitsOwned/unitsConstructed → cost stays at the base tier.
    // This is the regression case from issue #7 where captures used to make
    // the client over-estimate cost and falsely block legitimate builds.
    const playerLike = makePlayerLike({
      credits: 1_000_000n,
      ownedColonies: 2,
    });
    const bridge = new GameBridge(makeMockGameView(playerLike), MY_CLIENT_ID);
    bridge.initialize(new EventBus());

    bridge.tick();

    expect(
      useHUDStore.getState().cruiserHostableCosts.get(UnitType.Colony),
    ).toBe(colonyCost(0));
    bridge.destroy();
  });

  test("cost-function throws are isolated: tick() completes, bad entry omitted", () => {
    const playerLike = makePlayerLike({
      credits: 50_000n,
      ownedColonies: 0,
    });
    const mockGV = makeMockGameView(playerLike);
    mockGV.unitInfo = () => ({
      cost: () => {
        throw new Error("boom");
      },
    });
    const bridge = new GameBridge(mockGV, MY_CLIENT_ID);
    bridge.initialize(new EventBus());

    // The throw must not propagate — the rest of GameBridge.tick() (HUD
    // sync, player snapshot, scene fan-out) has to complete or the live
    // client tick loop in ClientGameRunner crashes.
    expect(() => bridge.tick()).not.toThrow();

    // The problematic cost is simply absent from the map; SpaceInputHandler
    // will fall through to the server-side host-only path for rejection.
    const costs = useHUDStore.getState().cruiserHostableCosts;
    expect(costs.has(UnitType.Colony)).toBe(false);

    // Other HUD state still updated this tick (player snapshot present).
    expect(useHUDStore.getState().myPlayer).not.toBeNull();
    bridge.destroy();
  });
});

describe("GameBridge → SpaceInputHandler integration (issue #7)", () => {
  let bridge: GameBridge;
  let handler: SpaceInputHandler;
  let bus: EventBus;
  let buildIntents: BuildUnitIntentEvent[];
  let ghostChanges: (UnitType | null)[];
  let toastSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useHUDStore.getState().reset();

    bus = new EventBus();

    // Player has 50k credits; first Colony costs 125k → cannot afford.
    const playerLike = makePlayerLike({
      credits: 50_000n,
      ownedColonies: 0,
    });
    bridge = new GameBridge(makeMockGameView(playerLike), MY_CLIENT_ID);
    bridge.initialize(bus);
    bridge.tick();

    // Manually select the cruiser snapshot the bridge just published, so
    // the hotkey path takes the host-only branch.
    useHUDStore.getState().setSelectedBattlecruiser(CRUISER_ID);

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
    bridge.destroy();
    (window as any).removeEventListener("show-message", toastSpy);
    useHUDStore.getState().reset();
  });

  test("finite credits below cost → toast fires, no BuildUnitIntent emitted", () => {
    // Sanity: bridge populated the cost map.
    expect(
      useHUDStore.getState().cruiserHostableCosts.get(UnitType.Colony),
    ).toBe(colonyCost(0));

    // Press Digit1 (default Colony hotkey) on the selected empty-slot cruiser.
    (window as any).dispatchEvent(
      new (globalThis as any).KeyboardEvent("keyup", { code: "Digit1" }),
    );

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const evt = toastSpy.mock.calls[0][0] as any;
    expect(evt.detail.color).toBe("red");
    expect(typeof evt.detail.message).toBe("string");
    expect(evt.detail.message.length).toBeGreaterThan(0);

    expect(buildIntents).toHaveLength(0);
    expect(ghostChanges).toHaveLength(0);
  });
});

describe("GameBridge → SpaceInputHandler with captured structures (issue #7 regression)", () => {
  let bridge: GameBridge;
  let handler: SpaceInputHandler;
  let bus: EventBus;
  let buildIntents: BuildUnitIntentEvent[];

  afterEach(() => {
    handler?.destroy();
    bridge?.destroy();
    useHUDStore.getState().reset();
  });

  test("captured Colony + affordable server cost → BuildUnitIntent still emitted", () => {
    // Scenario: player captured 1 Colony (so PlayerView.units(Colony).length
    // === 1) but the server-side `unitsConstructed[Colony]` is 0 (captures
    // don't increment it). Authoritative server cost for the next Colony
    // is therefore the base tier (125k); player has 150k → affordable.
    //
    // Before the fix, the client adapter fabricated `unitsConstructed`
    // from extant-units count, computed 250k, and SpaceInputHandler
    // suppressed the BuildUnitIntent — silently blocking a legitimate
    // build. With the conservative adapter, the client cost stays at
    // base (125k) so the gate doesn't trip and the intent is emitted.
    useHUDStore.getState().reset();
    bus = new EventBus();

    const playerLike = makePlayerLike({
      credits: 150_000n,
      ownedColonies: 1,
    });
    bridge = new GameBridge(makeMockGameView(playerLike), MY_CLIENT_ID);
    bridge.initialize(bus);
    bridge.tick();

    useHUDStore.getState().setSelectedBattlecruiser(CRUISER_ID);

    handler = new SpaceInputHandler(bus);
    handler.initialize();

    buildIntents = [];
    bus.on(BuildUnitIntentEvent, (e) => buildIntents.push(e));

    // Client cost reflects the conservative base tier (server-authoritative).
    expect(
      useHUDStore.getState().cruiserHostableCosts.get(UnitType.Colony),
    ).toBe(colonyCost(0));

    (window as any).dispatchEvent(
      new (globalThis as any).KeyboardEvent("keyup", { code: "Digit1" }),
    );

    expect(buildIntents).toHaveLength(1);
    expect(buildIntents[0].unit).toBe(UnitType.Colony);
    expect(buildIntents[0].hostBattlecruiserId).toBe(CRUISER_ID);
  });
});
