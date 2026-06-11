/**
 * Regression test for the worker-side error replies (`sendErrorResult` in
 * Worker.worker.ts): a request handler that cannot run must post an
 * error-carrying reply with the request id instead of throwing into the
 * void, so the matching WorkerClient promise rejects rather than pending
 * forever. The worker module binds its listener to `self`, which happy-dom
 * provides, so we drive it by dispatching synthetic MessageEvents before any
 * "init" message has created a game runner.
 */

const posted: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  vi.spyOn(
    self as unknown as { postMessage: (msg: unknown) => void },
    "postMessage",
  ).mockImplementation((msg: unknown) => {
    posted.push(msg as Record<string, unknown>);
  });
  await import("../../../src/core/worker/Worker.worker");
});

beforeEach(() => {
  posted.length = 0;
});

function dispatchToWorker(data: Record<string, unknown>): void {
  self.dispatchEvent(new MessageEvent("message", { data }));
}

describe("Worker request handlers reply with errors instead of throwing", () => {
  test.each([
    ["player_actions", "player_actions_result"],
    ["player_buildables", "player_buildables_result"],
    ["player_profile", "player_profile_result"],
    ["player_border_tiles", "player_border_tiles_result"],
    ["assault_shuttle_spawn", "assault_shuttle_spawn_result"],
  ])("%s replies with an error when uninitialized", (request, reply) => {
    dispatchToWorker({ type: request, id: "req-1", playerID: 1 });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: reply,
      id: "req-1",
      error: "Game runner not initialized",
    });
  });

  test("attack_clustered_positions replies with empty attacks when uninitialized", () => {
    dispatchToWorker({
      type: "attack_clustered_positions",
      id: "req-2",
      playerID: 1,
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: "attack_clustered_positions_result",
      id: "req-2",
      attacks: [],
    });
  });
});
