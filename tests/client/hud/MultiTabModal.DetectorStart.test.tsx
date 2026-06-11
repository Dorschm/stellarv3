// Regression test — multi-tab detector never started in multiplayer.
//
// MultiTabModal mounts before the first turn is processed, while
// gameView.inSpawnPhase() is still true. The monitoring effect used to
// depend only on [gameView] (a stable object), so it ran exactly once,
// hit the spawn-phase early return, and never retried — the detector
// (the anti-cheat this modal exists for) never started. The fix adds the
// tick counter to the dependency array so the effect re-evaluates after
// the spawn phase ends, with the detectorRef guard keeping the start
// exactly-once. The hook harness below respects dependency arrays, so the
// old mount-only behaviour would fail these assertions.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- React-hook harness (dependency-aware) --------------------------------
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

function runEffects(): Array<() => void> {
  const cleanups: Array<() => void> = [];
  for (const eff of harness.effects) {
    const ret = eff();
    if (typeof ret === "function") cleanups.push(ret as () => void);
  }
  return cleanups;
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
    // Dependency-aware useEffect: only schedules the effect when the deps
    // changed since the previous render (or on first render / no deps).
    // This is the part that makes the regression observable — a mount-only
    // effect with stable deps must NOT re-run on later renders.
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
const mocks = vi.hoisted(() => ({
  detectorInstances: [] as Array<{
    startMonitoring: ReturnType<typeof vi.fn>;
    stopMonitoring: ReturnType<typeof vi.fn>;
  }>,
  inSpawnPhase: true,
  tick: 0,
  gameView: null as unknown,
}));

vi.mock("../../../src/client/MultiTabDetector", () => ({
  MultiTabDetector: class {
    startMonitoring = vi.fn();
    stopMonitoring = vi.fn();
    constructor() {
      mocks.detectorInstances.push(this as never);
    }
  },
}));

vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

vi.mock("../../../src/client/hud/useGameTick", () => ({
  useGameTick: () => ({
    gameView: mocks.gameView,
    eventBus: {},
    tick: mocks.tick,
  }),
}));

import { GameEnv } from "../../../src/core/configuration/Config";
import { GameType } from "../../../src/core/game/Game";

const { MultiTabModal } = await import("../../../src/client/hud/MultiTabModal");

function setupGameView() {
  mocks.gameView = {
    inSpawnPhase: () => mocks.inSpawnPhase,
    config: () => ({
      gameConfig: () => ({ gameType: GameType.Public }),
      serverConfig: () => ({ env: () => GameEnv.Prod }),
      isReplay: () => false,
    }),
    myPlayer: () => ({ isAlive: () => true }),
  };
}

function render(): Array<() => void> {
  beginRender();
  MultiTabModal();
  return runEffects();
}

describe("MultiTabModal — detector start across spawn phase", () => {
  beforeEach(() => {
    resetHarness();
    mocks.detectorInstances = [];
    mocks.inSpawnPhase = true;
    mocks.tick = 0;
    setupGameView();
  });

  afterEach(() => {
    resetHarness();
  });

  test("detector starts exactly once after the spawn phase ends, and stops on unmount", () => {
    // Mount during spawn phase (ticks()===0 → inSpawnPhase true): the
    // monitoring effect early-returns, no detector yet. The []-deps
    // unmount cleanup is only scheduled on this first render, so capture
    // its cleanup functions here.
    const cleanups = render();
    expect(mocks.detectorInstances).toHaveLength(0);

    // Still in spawn phase on a later tick: still no detector.
    mocks.tick = 1;
    render();
    expect(mocks.detectorInstances).toHaveLength(0);

    // Spawn phase ends: the effect must re-evaluate (tick dep) and start
    // the detector. Under the old mount-only [gameView] deps this render
    // never re-ran the effect and the detector never existed.
    mocks.inSpawnPhase = false;
    mocks.tick = 2;
    render();
    expect(mocks.detectorInstances).toHaveLength(1);
    expect(mocks.detectorInstances[0].startMonitoring).toHaveBeenCalledTimes(1);

    // Subsequent ticks must NOT create or start a second detector.
    mocks.tick = 3;
    render();
    expect(mocks.detectorInstances).toHaveLength(1);
    expect(mocks.detectorInstances[0].startMonitoring).toHaveBeenCalledTimes(1);

    // Unmount: the cleanup must stop the detector so its heartbeat
    // interval and tab lock don't outlive the game session.
    for (const cleanup of cleanups) cleanup();
    expect(mocks.detectorInstances[0].stopMonitoring).toHaveBeenCalledTimes(1);
  });

  test("detector never starts in singleplayer", () => {
    mocks.gameView = {
      inSpawnPhase: () => false,
      config: () => ({
        gameConfig: () => ({ gameType: GameType.Singleplayer }),
        serverConfig: () => ({ env: () => GameEnv.Prod }),
        isReplay: () => false,
      }),
      myPlayer: () => ({ isAlive: () => true }),
    };
    render();
    mocks.tick = 1;
    render();
    expect(mocks.detectorInstances).toHaveLength(0);
  });
});
