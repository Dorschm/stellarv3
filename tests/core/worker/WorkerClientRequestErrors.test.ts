import { PlayerID } from "../../../src/core/game/Game";
import { GameStartInfo } from "../../../src/core/Schemas";
import { WorkerClient } from "../../../src/core/worker/WorkerClient";

/**
 * Regression tests for the request/response RPC hardening in WorkerClient:
 * a worker-side failure must reject the pending promise (via the `error`
 * reply field set by `sendErrorResult` in Worker.worker.ts), an unexpected
 * reply shape must reject, and a lost reply must reject after the timeout —
 * previously all three left the promise pending forever and leaked the
 * messageHandlers entry.
 */

type SentMessage = { type: string; id?: string; [key: string]: unknown };

class FakeWorker {
  static lastInstance: FakeWorker | null = null;
  readonly sent: SentMessage[] = [];
  /** When set, called for every message posted to the worker; a non-undefined
   * return value is immediately emitted back to the main thread. */
  autoReply: ((msg: SentMessage) => unknown) | null = null;
  private listeners: Array<(event: { data: unknown }) => void> = [];

  constructor(_url: unknown, _options?: unknown) {
    FakeWorker.lastInstance = this;
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") {
      this.listeners.push(listener);
    }
  }

  postMessage(msg: SentMessage) {
    this.sent.push(msg);
    const reply = this.autoReply?.(msg);
    if (reply !== undefined) {
      this.emit(reply);
    }
  }

  emit(data: unknown) {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }

  terminate() {}
}

async function createClient(): Promise<{
  client: WorkerClient;
  fake: FakeWorker;
}> {
  const client = new WorkerClient({} as GameStartInfo, "client1");
  const fake = FakeWorker.lastInstance!;
  fake.autoReply = (msg) =>
    msg.type === "init" ? { type: "initialized", id: msg.id } : undefined;
  await client.initialize();
  fake.autoReply = null;
  return { client, fake };
}

describe("WorkerClient request error handling", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWorker.lastInstance = null;
  });

  test("rejects when the worker replies with an error", async () => {
    const { client, fake } = await createClient();

    const promise = client.playerProfile(7);
    const request = fake.sent.at(-1)!;
    expect(request.type).toBe("player_profile");

    fake.emit({
      type: "player_profile_result",
      id: request.id,
      error: "player with id 7 not found",
    });

    await expect(promise).rejects.toThrow("player with id 7 not found");
  });

  test("resolves normally when the worker replies with a result", async () => {
    const { client, fake } = await createClient();

    const promise = client.playerInteraction("p1" as PlayerID, 1, 2);
    const request = fake.sent.at(-1)!;
    const result = { canAttack: false, buildableUnits: [] };

    fake.emit({
      type: "player_actions_result",
      id: request.id,
      result,
    });

    await expect(promise).resolves.toEqual(result);
  });

  test("resolves a `false` transportShipSpawn result (not treated as missing)", async () => {
    const { client, fake } = await createClient();

    const promise = client.transportShipSpawn("p1" as PlayerID, 42);
    const request = fake.sent.at(-1)!;

    fake.emit({
      type: "assault_shuttle_spawn_result",
      id: request.id,
      result: false,
    });

    await expect(promise).resolves.toBe(false);
  });

  test("rejects on a reply with an unexpected type", async () => {
    const { client, fake } = await createClient();

    const promise = client.playerProfile(3);
    const request = fake.sent.at(-1)!;

    fake.emit({
      type: "player_buildables_result",
      id: request.id,
      result: [],
    });

    await expect(promise).rejects.toThrow(/Unexpected/);
  });

  test("rejects and cleans up when no reply arrives within the timeout", async () => {
    vi.useFakeTimers();
    const { client, fake } = await createClient();

    const promise = client.playerBorderTiles("p1" as PlayerID);
    const request = fake.sent.at(-1)!;
    const expectation = expect(promise).rejects.toThrow(/timed out/);

    vi.advanceTimersByTime(5000);
    await expectation;

    // The pending handler entry was deleted: a late reply is silently
    // ignored instead of resurrecting the settled promise.
    expect(() =>
      fake.emit({
        type: "player_border_tiles_result",
        id: request.id,
        result: { borderTiles: [] },
      }),
    ).not.toThrow();
  });
});
