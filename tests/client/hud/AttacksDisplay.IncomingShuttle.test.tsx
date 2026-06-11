// Regression test — incoming-shuttle warnings dropped under throttled renders.
//
// AttacksDisplay renders via useGameTick(100), which deliberately skips
// re-renders arriving <100ms apart. It used to harvest UnitIncoming
// (ORBITAL_ASSAULT_INBOUND) events by polling gameView.updatesSinceLastTick()
// from the throttled tick effect — but the GameView update buffer is
// overwritten on every tick, so any tick whose render was throttled away
// lost its events permanently and the incoming-shuttle row never appeared.
// The fix ingests UnitIncoming events through a SceneTickEvent listener
// (the per-tick feed the codebase standardized in WinModal), keeping the
// throttled render purely for presentation. This test simulates the
// throttled case: ticks fire (SceneTickEvents emitted) with NO re-render in
// between, and updatesSinceLastTick() always returns null (buffer already
// overwritten) — the shuttle warning must still appear.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- React-hook harness ----------------------------------------------------
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
    useCallback: <T,>(fn: T): T => fn,
    // Dependency-aware useEffect so listener registration (stable deps)
    // happens once while the tick effect re-runs per render.
    useEffect: (fn: () => unknown, deps?: unknown[]) => {
      const i = harness.idx++;
      const prev = harness.slots[i]?.value as
        | { deps: unknown[] | undefined }
        | undefined;
      const changed =
        prev === undefined ||
        deps === undefined ||
        prev.deps === undefined ||
        deps.length !== prev.deps.length ||
        deps.some((d, j) => !Object.is(d, prev.deps![j]));
      harness.slots[i] = { value: { deps } };
      if (changed) harness.effects.push(fn);
    },
  };
});

// ---- Module mocks ----------------------------------------------------------
const mocks = vi.hoisted(() => {
  const eventBusListeners = new Map<unknown, Array<(e: unknown) => void>>();
  return {
    tick: 0,
    gameView: null as unknown,
    eventBusListeners,
    // Stable identity across renders — the listener effect depends on
    // [eventBus, gameView], so a per-render object would re-register the
    // handler on every render.
    eventBus: {
      on: (eventType: unknown, cb: (e: unknown) => void) => {
        const existing = eventBusListeners.get(eventType) ?? [];
        existing.push(cb);
        eventBusListeners.set(eventType, existing);
      },
      off: () => {},
      emit: () => {},
    },
  };
});

vi.mock("../../../src/client/Utils", () => ({
  renderPopulation: (n: number) => String(n),
  translateText: (key: string) => key,
}));

vi.mock("../../../src/core/AssetUrls", () => ({
  assetUrl: (p: string) => p,
}));

vi.mock("../../../src/client/bridge/HUDStore", () => ({
  useHUDStore: (selector: (s: { attackRatio: number }) => unknown) =>
    selector({ attackRatio: 20 }),
}));

vi.mock("../../../src/client/hud/useGameTick", () => ({
  useGameTick: () => ({
    gameView: mocks.gameView,
    eventBus: mocks.eventBus,
    tick: mocks.tick,
  }),
}));

import { SceneTickEvent } from "../../../src/client/InputHandler";
import { MessageType, UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";

const { AttacksDisplay } = await import(
  "../../../src/client/hud/AttacksDisplay"
);

const MY_SMALL_ID = 42;
const SHUTTLE_UNIT_ID = 777;
const ENEMY_NAME = "EnemyShuttleOwner";

function makeShuttleUnit() {
  return {
    id: () => SHUTTLE_UNIT_ID,
    isActive: () => true,
    type: () => UnitType.AssaultShuttle,
    population: () => 5000,
    retreating: () => false,
    targetTile: () => undefined,
    owner: () => ({
      id: () => "enemy",
      displayName: () => ENEMY_NAME,
    }),
  };
}

function setupGameView() {
  const shuttle = makeShuttleUnit();
  mocks.gameView = {
    inSpawnPhase: () => false,
    myPlayer: () => ({
      smallID: () => MY_SMALL_ID,
      isAlive: () => true,
      incomingAttacks: () => [],
      outgoingAttacks: () => [],
      units: () => [],
    }),
    // Worst case for the old polling pattern: the buffer was already
    // overwritten by a newer tick, so polling yields nothing.
    updatesSinceLastTick: () => null,
    unit: (id: number) => (id === SHUTTLE_UNIT_ID ? shuttle : undefined),
    playerBySmallID: () => undefined,
    config: () => ({ theme: () => ({}) }),
  };
}

function render(): unknown {
  harness.idx = 0;
  harness.effects = [];
  const out = AttacksDisplay();
  for (const eff of harness.effects) eff();
  return out;
}

function emitSceneTick(tick: number, unitUpdates: unknown[]) {
  const event = new SceneTickEvent(tick, {
    [GameUpdateType.UnitIncoming]: unitUpdates,
  } as never);
  const listeners = mocks.eventBusListeners.get(SceneTickEvent) ?? [];
  for (const cb of listeners) cb(event);
}

describe("AttacksDisplay — incoming shuttle warnings under throttled renders", () => {
  beforeEach(() => {
    resetHarness();
    mocks.tick = 0;
    // clear() not reassignment — the eventBus closure captures this Map.
    mocks.eventBusListeners.clear();
    setupGameView();
  });

  afterEach(() => {
    resetHarness();
  });

  test("UnitIncoming events delivered between throttled renders still produce the warning row", () => {
    // Mount: registers the SceneTickEvent listener.
    render();
    expect(mocks.eventBusListeners.get(SceneTickEvent)).toHaveLength(1);

    // Two game ticks arrive back-to-back with NO React render in between
    // (the useGameTick(100) throttle skipped them). The second tick has
    // already replaced the GameView update buffer, so the old
    // updatesSinceLastTick() polling would never see the inbound event.
    emitSceneTick(10, [
      {
        playerID: MY_SMALL_ID,
        unitID: SHUTTLE_UNIT_ID,
        messageType: MessageType.ORBITAL_ASSAULT_INBOUND,
      },
    ]);
    emitSceneTick(11, []);

    // Next throttled render: the tick effect resolves the tracked unit id
    // into an incoming-shuttle row.
    mocks.tick = 1;
    render();
    const tree = render();

    expect(JSON.stringify(tree)).toContain(ENEMY_NAME);
  });

  test("events for other players or other message types are ignored", () => {
    render();

    emitSceneTick(10, [
      {
        playerID: MY_SMALL_ID + 1, // someone else's warning
        unitID: SHUTTLE_UNIT_ID,
        messageType: MessageType.ORBITAL_ASSAULT_INBOUND,
      },
      {
        playerID: MY_SMALL_ID,
        unitID: SHUTTLE_UNIT_ID,
        messageType: MessageType.ATTACK_REQUEST, // not a shuttle warning
      },
    ]);

    mocks.tick = 1;
    render();
    const tree = render();

    expect(JSON.stringify(tree)).not.toContain(ENEMY_NAME);
  });
});
