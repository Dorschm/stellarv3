// @vitest-environment node
//
// Targeted coverage for the outgoing config payloads the HostLobbyModal
// builds via `buildConfigPayload`. The modal pushes this payload to the
// server three different ways (on initial join, via `update_game_config`
// whenever state changes, and inside the `start_game` POST body), and all
// three paths must carry the GDD §1/§10 `winCondition: Elimination` +
// `permadeath` contract. A regression that drops either field from
// `buildConfigPayload` — or silently freezes the memoized callback so toggle
// state stops propagating — should fail here before it reaches players.
//
// Why a node env + custom React hook mocks instead of a full DOM render: the
// project's jsdom environment is currently incompatible with its Node toolchain
// (html-encoding-sniffer requires @exodus/bytes as CJS while the latter ships
// ESM-only, and Node 22.11 doesn't load it under `require()` without an
// experimental flag). A manual hook harness lets us exercise the modal's
// render function and its click/change handlers without standing up jsdom.

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
  WinCondition,
} from "../../src/core/game/Game";

// ---- Hook harness --------------------------------------------------------
// Shared state across vi.mock factories and the test body. vi.hoisted makes
// the factory see the same object reference the test body mutates.
const harness = vi.hoisted(() => ({
  // `slots` persists state between renders — one slot per useState/useRef/
  // useMemo call, in call order (React-style). `idx` is reset before each
  // render so the call order lines up with existing slot values.
  slots: [] as Array<{ value: unknown }>,
  idx: 0,
  // Effects pushed during the current render; tests invoke them explicitly.
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
// Captured callbacks and mock functions shared between the vi.mock factories
// and the test body. The ModalPage mock stashes `onOpen` here so tests can
// await it directly without having to coax it out of a fake `useEffect`.
const mocks = vi.hoisted(() => ({
  joinLobby: vi.fn(),
  leaveLobby: vi.fn(),
  updateGameConfig: vi.fn(),
  showPage: vi.fn(),
  getPlayToken: vi.fn(),
  fetch: vi.fn(),
  eventBusOn: vi.fn(),
  eventBusOff: vi.fn(),
  capturedOnOpen: null as (() => Promise<void> | void) | null,
  capturedOnClose: null as (() => void) | null,
}));

vi.mock("../../src/client/shell/contexts/ClientContext", () => ({
  useClient: () => ({
    eventBus: { on: mocks.eventBusOn, off: mocks.eventBusOff },
    joinLobby: mocks.joinLobby,
    leaveLobby: mocks.leaveLobby,
    updateGameConfig: mocks.updateGameConfig,
  }),
}));

vi.mock("../../src/client/shell/contexts/NavigationContext", () => ({
  useNavigation: () => ({ showPage: mocks.showPage }),
}));

// Capture `onOpen`/`onClose` globally so the test can drive the async
// initial-join flow explicitly. The real ModalPage wires these to a
// visibility-gated useEffect; for the harness we just stash them and return
// the children directly so the tree walker can reach host elements.
vi.mock("../../src/client/shell/components/ModalPage", () => ({
  ModalPage: ({
    children,
    onOpen,
    onClose,
  }: {
    children: React.ReactNode;
    onOpen?: () => Promise<void> | void;
    onClose?: () => void;
  }) => {
    mocks.capturedOnOpen = onOpen ?? null;
    mocks.capturedOnClose = onClose ?? null;
    return children;
  },
  ModalContainer: ({ children }: { children: React.ReactNode }) => children,
}));

// `generateID` returns random strings in prod. Pin it so lobby URLs and fetch
// paths are deterministic in assertions.
vi.mock("../../src/core/Util", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/Util")>(
    "../../src/core/Util",
  );
  return {
    ...actual,
    generateID: () => "test-lobby-id",
  };
});

vi.mock("../../src/client/Auth", () => ({
  getPlayToken: mocks.getPlayToken,
}));

// Fake `ServerConfig` — the modal only calls `.workerPath(gameID)`.
vi.mock("../../src/core/configuration/ConfigLoader", () => ({
  getRuntimeClientServerConfig: async () => ({
    workerPath: (_id: string) => "w0",
  }),
}));

// The modal loads translated labels for UI affordances — stub everything to
// return the key so text-match helpers can anchor on predictable strings.
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

// HostLobbyModal imports `LobbyInfoEvent` from Schemas purely as an event
// class reference for `eventBus.on(LobbyInfoEvent, ...)`. A placeholder class
// is enough — nothing in the test path calls the real Schemas module.
vi.mock("../../src/core/Schemas", () => ({
  LobbyInfoEvent: class LobbyInfoEvent {},
}));

// Import after every mock is registered so the modal picks up the fakes.
const { HostLobbyModal } = await import(
  "../../src/client/shell/modals/HostLobbyModal"
);

// ---- Tree walking helpers ------------------------------------------------
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

// Recursively invoke function components until every element in the tree has
// a host-element `type` (string) or is a leaf value. This mirrors what React
// would do during a render pass, and lets tests query `props.onClick` and
// `props.onChange` on the resulting structure directly.
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

function* walk(
  node: RenderedNode,
): Generator<
  Extract<RenderedNode, { type: string | ((...args: unknown[]) => unknown) }>
> {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) yield* walk(c);
    return;
  }
  yield node as Extract<
    RenderedNode,
    { type: string | ((...args: unknown[]) => unknown) }
  >;
  const children = (node as { props?: { children?: RenderedNode } }).props
    ?.children;
  if (children !== null && children !== undefined) yield* walk(children);
}

function textOf(node: RenderedNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return textOf(
    (node as { props?: { children?: RenderedNode } }).props?.children,
  );
}

function findButton(
  tree: RenderedNode,
  pattern: RegExp,
): { props: Record<string, unknown> } {
  for (const el of walk(tree)) {
    if (el.type === "button" && pattern.test(textOf(el as RenderedNode))) {
      return el as unknown as { props: Record<string, unknown> };
    }
  }
  throw new Error(`No button matching ${pattern} in rendered modal`);
}

function findCheckbox(tree: RenderedNode): {
  props: Record<string, unknown>;
} {
  for (const el of walk(tree)) {
    if (
      el.type === "input" &&
      (el as { props?: { type?: string } }).props?.type === "checkbox"
    ) {
      return el as unknown as { props: Record<string, unknown> };
    }
  }
  throw new Error("No checkbox input in rendered modal");
}

// Allow awaited chains (getPlayToken, fetch, joinLobby, updateGameConfig) to
// settle before we assert on the mocks.
async function flushAsync() {
  for (let i = 0; i < 8; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

type HostConfigPayload = {
  gameMap: GameMapType;
  gameType: GameType;
  gameMode: GameMode;
  difficulty: Difficulty;
  winCondition: WinCondition;
  permadeath: boolean;
};

// ---- Tests ---------------------------------------------------------------
describe("HostLobbyModal outgoing config payloads", () => {
  beforeEach(() => {
    resetHarness();
    mocks.joinLobby.mockReset().mockResolvedValue(undefined);
    mocks.leaveLobby.mockReset();
    mocks.updateGameConfig.mockReset();
    mocks.showPage.mockReset();
    mocks.getPlayToken.mockReset().mockResolvedValue("test-token");
    mocks.fetch.mockReset().mockResolvedValue({ ok: true, status: 200 });
    mocks.eventBusOn.mockReset();
    mocks.eventBusOff.mockReset();
    mocks.capturedOnOpen = null;
    mocks.capturedOnClose = null;
    // Replace the global fetch so the modal's create_game / start_game POSTs
    // are observable without hitting a real server.
    vi.stubGlobal("fetch", mocks.fetch);
    // Node env doesn't ship a `window`/`CustomEvent`; provide just enough
    // surface to satisfy `window.location.origin` (for lobby URL display)
    // and the `show-message` dispatch paths the modal uses on errors.
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        constructor(
          public type: string,
          public init?: { detail?: unknown },
        ) {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetHarness();
  });

  it("pushes Elimination + permadeath=true through updateGameConfig on initial join", async () => {
    beginRender();
    renderTree(React.createElement(HostLobbyModal) as unknown as RenderedNode);

    expect(mocks.capturedOnOpen).toBeTypeOf("function");

    // Drive the async onOpen chain the real ModalPage would have kicked off
    // via useEffect. It issues the create_game fetch, joins the lobby, then
    // pushes buildConfigPayload() via updateGameConfig — that last call is
    // the contract we care about.
    await mocks.capturedOnOpen!();
    await flushAsync();

    // The create_game POST should have been made to the per-worker API path.
    expect(mocks.fetch).toHaveBeenCalled();
    const createCall = mocks.fetch.mock.calls.find(
      (call) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("/api/create_game/test-lobby-id"),
    );
    expect(createCall).toBeDefined();

    // updateGameConfig is the authoritative push — assert that the payload
    // carries elimination + permadeath on.
    expect(mocks.updateGameConfig).toHaveBeenCalled();
    const lastConfig = mocks.updateGameConfig.mock.calls.at(
      -1,
    )![0] as HostConfigPayload;
    expect(lastConfig.gameType).toBe(GameType.Private);
    // GDD §1 — private lobbies default to last-faction-standing.
    expect(lastConfig.winCondition).toBe(WinCondition.Elimination);
    // GDD §10 — permadeath defaults to ON for private lobbies.
    expect(lastConfig.permadeath).toBe(true);
  });

  it("pushes an updated payload through updateGameConfig when permadeath is toggled off", async () => {
    beginRender();
    let tree = renderTree(
      React.createElement(HostLobbyModal) as unknown as RenderedNode,
    );

    // Complete the join flow first so lobbyReadyRef.current becomes true —
    // without that, the config-update effect early-returns.
    await mocks.capturedOnOpen!();
    await flushAsync();
    const callsAfterOpen = mocks.updateGameConfig.mock.calls.length;
    expect(callsAfterOpen).toBeGreaterThan(0);
    expect(
      (mocks.updateGameConfig.mock.calls.at(-1)![0] as HostConfigPayload)
        .permadeath,
    ).toBe(true);

    // Flip the permadeath checkbox via the onChange React wired up. The
    // setter mutates shared slot state, so the next render sees the new
    // value.
    const checkbox = findCheckbox(tree);
    expect(checkbox.props.checked).toBe(true);
    (checkbox.props.onChange as (e: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });

    // Re-render — HostLobbyModal's config-update useEffect is queued again,
    // and since lobbyReadyRef.current is now true from the previous open, it
    // will call updateGameConfig(buildConfigPayload()) with the new toggle
    // state.
    beginRender();
    tree = renderTree(
      React.createElement(HostLobbyModal) as unknown as RenderedNode,
    );
    expect(findCheckbox(tree).props.checked).toBe(false);

    // The first effect queued each render is the config-update effect (the
    // second is the LobbyInfoEvent subscription). Run just that one so we
    // don't accidentally re-fire the onOpen path again.
    await (harness.effects[0] as () => Promise<void> | void)?.();
    await flushAsync();

    // A fresh updateGameConfig call should land with the toggled state.
    expect(mocks.updateGameConfig.mock.calls.length).toBeGreaterThan(
      callsAfterOpen,
    );
    const lastConfig = mocks.updateGameConfig.mock.calls.at(
      -1,
    )![0] as HostConfigPayload;
    // Win condition stays elimination — only `permadeath` flips.
    expect(lastConfig.winCondition).toBe(WinCondition.Elimination);
    expect(lastConfig.permadeath).toBe(false);
  });

  it("includes winCondition + permadeath in the start_game POST body", async () => {
    beginRender();
    renderTree(React.createElement(HostLobbyModal) as unknown as RenderedNode);

    await mocks.capturedOnOpen!();
    await flushAsync();
    // Reset so the start_game fetch is easy to locate without scanning past
    // the create_game call made during onOpen.
    mocks.fetch.mockClear();

    // Re-render so the Start button's `handleStartGame` closure captures the
    // lobbyId state that `onOpen` just wrote. The useCallback doesn't refresh
    // until the next render pass.
    beginRender();
    const tree = renderTree(
      React.createElement(HostLobbyModal) as unknown as RenderedNode,
    );

    const start = findButton(tree, /start_game/i);
    await (start.props.onClick as () => Promise<void> | void)?.();
    await flushAsync();

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain("/api/start_game/test-lobby-id");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body) as { config: HostConfigPayload };
    // The start_game POST must carry the final authoritative config — the
    // server locks it in before `game.start()`. Any regression that drops
    // `permadeath` or `winCondition` here will mismatch gameplay silently.
    expect(body.config.winCondition).toBe(WinCondition.Elimination);
    expect(body.config.permadeath).toBe(true);
    expect(body.config.gameType).toBe(GameType.Private);
  });
});
