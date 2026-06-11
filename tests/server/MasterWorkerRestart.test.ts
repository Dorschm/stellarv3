import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for the crashed-worker restart path in Master.ts.
 *
 * Node's cluster module does not populate `worker.process.env`, so the
 * exit handler must look up the crashed worker's WORKER_ID from the
 * fork-time mapping kept by the master — not from the worker object.
 * Before the fix, every crash hit the "could not find id" branch and the
 * worker (and its share of game hosting capacity) was never restarted.
 */

const clusterState = vi.hoisted(() => {
  const state = {
    forked: [] as Array<{
      env: Record<string, unknown>;
      worker: { id: number; process: { pid: number } };
    }>,
    handlers: new Map<string, (...args: any[]) => void>(),
    nextId: 1,
  };
  return state;
});

vi.mock("cluster", () => {
  const fork = (env: Record<string, unknown>) => {
    const worker = {
      id: clusterState.nextId++,
      // NOTE: deliberately no `env` property — mirrors real cluster
      // workers, whose ChildProcess does not expose the fork env.
      process: { pid: 1000 + clusterState.nextId },
    };
    clusterState.forked.push({ env, worker });
    return worker;
  };
  const on = (event: string, handler: (...args: any[]) => void) => {
    clusterState.handlers.set(event, handler);
  };
  return { default: { isPrimary: true, fork, on } };
});

vi.mock("http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("http")>();
  const createServer = vi.fn(() => ({ listen: vi.fn() }));
  return {
    ...actual,
    default: { ...(actual as any).default, createServer },
    createServer,
  };
});

const lobbyServiceMock = vi.hoisted(() => ({
  registerWorker: vi.fn(),
  removeWorker: vi.fn(),
  isHealthy: vi.fn(() => true),
}));

vi.mock("../../src/server/MasterLobbyService", () => ({
  MasterLobbyService: class {
    registerWorker = lobbyServiceMock.registerWorker;
    removeWorker = lobbyServiceMock.removeWorker;
    isHealthy = lobbyServiceMock.isHealthy;
  },
}));

vi.mock("../../src/server/api", () => ({
  mountSelfHostedApi: vi.fn(),
}));

vi.mock("../../src/server/MapPlaylist", () => ({
  MapPlaylist: class {},
}));

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

// Under vitest import.meta.env.MODE is "test", which the real loader
// rejects; pin the dev server config (2 workers) instead.
vi.mock("../../src/core/configuration/ConfigLoader", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { DevServerConfig } = await import(
    "../../src/core/configuration/DevConfig"
  );
  return {
    ...actual,
    getServerConfigFromServer: () => new DevServerConfig(),
  };
});

describe("Master worker restart", () => {
  it("re-forks a crashed worker with the same WORKER_ID", async () => {
    const { startMaster } = await import("../../src/server/Master");
    await startMaster();

    // Dev config forks workers with sequential WORKER_IDs.
    const initial = [...clusterState.forked];
    expect(initial.length).toBeGreaterThan(1);
    expect(initial.map((f) => f.env.WORKER_ID)).toEqual(
      initial.map((_, i) => i),
    );
    expect(lobbyServiceMock.registerWorker).toHaveBeenCalledTimes(
      initial.length,
    );

    const exitHandler = clusterState.handlers.get("exit");
    expect(exitHandler).toBeDefined();

    // Crash worker 1.
    const crashed = initial.find((f) => f.env.WORKER_ID === 1)!;
    exitHandler!(crashed.worker, 1, null);

    // A replacement was forked with the same WORKER_ID...
    const reforked = clusterState.forked.slice(initial.length);
    expect(reforked).toHaveLength(1);
    expect(reforked[0].env.WORKER_ID).toBe(1);
    // ...and the lobby service dropped the dead worker and got the new one.
    expect(lobbyServiceMock.removeWorker).toHaveBeenCalledWith(1);
    expect(lobbyServiceMock.registerWorker).toHaveBeenLastCalledWith(
      1,
      reforked[0].worker,
    );

    // A crash of the replacement restarts it again — the id mapping
    // tracks reforked workers, not just the initial set.
    exitHandler!(reforked[0].worker, 1, null);
    const second = clusterState.forked.slice(initial.length + 1);
    expect(second).toHaveLength(1);
    expect(second[0].env.WORKER_ID).toBe(1);
  });
});
