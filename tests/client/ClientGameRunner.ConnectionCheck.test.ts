// Regression test — orphaned connection-check interval.
//
// ClientGameRunner.start() arms a 20s warm-up setTimeout that installs the
// 1Hz connection-check interval. Before the fix, stop() never cancelled the
// pending warm-up timeout: leaving a game within 20s of start let the
// timeout fire on the dead runner and install an interval nothing could
// ever clear, so transport.reconnect() kept rejoining the abandoned game
// (zombie WebSocket + permanent 1Hz timer) for the rest of the page's life.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";

vi.mock("../../src/client/sound/SoundManager", () => ({
  default: {
    playBackgroundMusic: vi.fn(),
    stopBackgroundMusic: vi.fn(),
  },
}));

vi.mock("../../src/client/scene/ReactRoot", () => ({
  mountReactRoot: vi.fn(),
  unmountReactRoot: vi.fn(),
}));

const { ClientGameRunner } = await import("../../src/client/ClientGameRunner");

function makeTransport() {
  return {
    isLocal: false,
    reconnect: vi.fn(),
    leaveGame: vi.fn(),
    updateCallback: vi.fn(),
    rejoinGame: vi.fn(),
    turnComplete: vi.fn(),
  };
}

function makeRunner(transport: ReturnType<typeof makeTransport>) {
  const lobby = {
    serverConfig: {} as never,
    cosmetics: {} as never,
    playerName: "tester",
    playerClanTag: null,
    gameID: "testgame",
    turnstileToken: null,
  };
  const input = { initialize: vi.fn(), destroy: vi.fn() };
  const bridge = {
    initialize: vi.fn(),
    destroy: vi.fn(),
    tick: vi.fn(),
    setSelectedTile: vi.fn(),
  };
  const worker = { start: vi.fn(), cleanup: vi.fn(), sendTurn: vi.fn() };
  const gameView = {
    config: () => ({ isRandomSpawn: () => false, isReplay: () => false }),
  };
  return new ClientGameRunner(
    lobby as never,
    "client1" as never,
    new EventBus(),
    input as never,
    bridge as never,
    transport as never,
    worker as never,
    gameView as never,
  );
}

describe("ClientGameRunner connection-check lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test("stopping within the 20s warm-up cancels the pending interval — no ghost reconnects", () => {
    const transport = makeTransport();
    const runner = makeRunner(transport);

    runner.start();
    // Player backs out of the game 5s in — well before the warm-up fires.
    vi.advanceTimersByTime(5_000);
    runner.stop();

    // Without the fix the warm-up timeout fires at t=20s on the dead
    // runner, installs the 1Hz interval, and reconnect() fires every
    // second once 5s pass without a server message.
    vi.advanceTimersByTime(120_000);

    expect(transport.reconnect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("connection check still reconnects on silence while the runner is active, and stops afterwards", () => {
    const transport = makeTransport();
    const runner = makeRunner(transport);

    runner.start();
    // Warm-up elapses, interval installed; no server messages arrive, so
    // after >5s of silence the check should reconnect.
    vi.advanceTimersByTime(20_000 + 6_000);
    expect(transport.reconnect).toHaveBeenCalled();

    const callsAtStop = transport.reconnect.mock.calls.length;
    runner.stop();
    vi.advanceTimersByTime(60_000);

    // No further reconnect attempts and no timers left behind.
    expect(transport.reconnect.mock.calls.length).toBe(callsAtStop);
    expect(vi.getTimerCount()).toBe(0);
  });
});
