// @vitest-environment node
//
// Targeted coverage for the outgoing config payload the SinglePlayerModal
// sends to `joinLobby`. This test guards the GDD §1/§10 contract that every
// singleplayer run is Elimination-based and that the `permadeath` checkbox
// state is propagated verbatim into the payload. A regression that drops or
// silently flips either field will fail here before it can ship to players.
//
// Why a node env + custom React hook mocks instead of a full DOM render: the
// project's jsdom environment is currently incompatible with its Node toolchain
// (html-encoding-sniffer requires @exodus/bytes as CJS while the latter ships
// ESM-only, and Node 22.11 doesn't load it under `require()` without an
// experimental flag). A manual hook harness lets us exercise the modal's
// render function and its click handlers without standing up jsdom at all.

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Difficulty,
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
  // Effects pushed during the current render. Tests can choose to invoke
  // them explicitly; nothing runs them automatically.
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
// Mock-function handles hoisted above `vi.mock` factories so we can reset
// them between tests and inspect recorded calls.
const mocks = vi.hoisted(() => ({
  joinLobby: vi.fn(),
  showPage: vi.fn(),
  requestMidgameAd: vi.fn(),
  getPlayerCosmetics: vi.fn(),
}));

// Replace the contexts the modal pulls from with stubs that expose just the
// refs/callbacks it touches. This sidesteps the real ClientContext, which
// would otherwise transitively pull in auth, websocket, and lobby machinery.
vi.mock("../../src/client/shell/contexts/ClientContext", () => ({
  useClient: () => ({
    joinLobby: mocks.joinLobby,
    getUsernameRef: { current: () => "test-user" },
    getClanTagRef: { current: () => null },
  }),
}));

vi.mock("../../src/client/shell/contexts/NavigationContext", () => ({
  useNavigation: () => ({ showPage: mocks.showPage }),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { requestMidgameAd: mocks.requestMidgameAd },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: mocks.getPlayerCosmetics,
}));

vi.mock("../../src/client/AnonUsername", () => ({
  genAnonUsername: () => "anon-test",
}));

// `countWins` and `aiDifficultyForWinCount` would otherwise read/parse
// localStorage and map the result into the Difficulty enum. Freezing them to
// a known value keeps the default-difficulty path deterministic.
vi.mock("../../src/client/RunHistory", () => ({
  countWins: () => 0,
  aiDifficultyForWinCount: () => Difficulty.Easy,
}));

// Strip the navigation visibility gate so the modal mounts inside the harness.
// The real ModalPage hides children until `currentPage` matches; since the
// modal body is what we care about, the mock just returns the children
// directly without any DOM wrapper so the tree walker sees them.
vi.mock("../../src/client/shell/components/ModalPage", () => ({
  ModalPage: ({ children }: { children: React.ReactNode }) => children,
  ModalContainer: ({ children }: { children: React.ReactNode }) => children,
}));

// Import after all mocks are registered so the modal picks up the fakes.
const { SinglePlayerModal } = await import(
  "../../src/client/shell/modals/SinglePlayerModal"
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

// Allow the awaited chain inside handleStart (cosmetics + midgame ad +
// joinLobby) to settle before we assert on the mocks.
async function flushAsync() {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

// ---- Tests ---------------------------------------------------------------
describe("SinglePlayerModal outgoing config payload", () => {
  beforeEach(() => {
    resetHarness();
    mocks.joinLobby.mockReset().mockResolvedValue(undefined);
    mocks.showPage.mockReset();
    mocks.requestMidgameAd.mockReset().mockResolvedValue(undefined);
    mocks.getPlayerCosmetics
      .mockReset()
      .mockResolvedValue({ flag: null, pattern: null });
  });

  afterEach(() => {
    resetHarness();
  });

  it("starts with Elimination + permadeath enabled by default", async () => {
    beginRender();
    const tree = renderTree(
      React.createElement(SinglePlayerModal) as unknown as RenderedNode,
    );

    const checkbox = findCheckbox(tree);
    // GDD §10 — permadeath defaults to ON for singleplayer.
    expect(checkbox.props.checked).toBe(true);

    const start = findButton(tree, /start game/i);
    await (start.props.onClick as () => Promise<void> | void)?.();
    await flushAsync();

    expect(mocks.joinLobby).toHaveBeenCalledTimes(1);
    const payload = (mocks.joinLobby.mock.calls[0] as unknown[])[0] as {
      source: string;
      gameStartInfo: {
        config: {
          gameType: unknown;
          gameMode: unknown;
          winCondition: unknown;
          permadeath: unknown;
        };
      };
    };
    expect(payload.source).toBe("singleplayer");
    expect(payload.gameStartInfo.config.gameType).toBe(GameType.Singleplayer);
    expect(payload.gameStartInfo.config.gameMode).toBe(GameMode.FFA);
    // GDD §1 — singleplayer is always last-faction-standing.
    expect(payload.gameStartInfo.config.winCondition).toBe(
      WinCondition.Elimination,
    );
    // GDD §10 — permadeath toggle state is propagated unchanged.
    expect(payload.gameStartInfo.config.permadeath).toBe(true);
  });

  it("propagates a toggled-off permadeath state into the outgoing config", async () => {
    beginRender();
    let tree = renderTree(
      React.createElement(SinglePlayerModal) as unknown as RenderedNode,
    );

    // First render: permadeath is on. Flip it via the onChange prop React
    // would wire up to the checkbox; the setter mutates shared slot state.
    const checkbox = findCheckbox(tree);
    expect(checkbox.props.checked).toBe(true);
    (checkbox.props.onChange as (e: { target: { checked: boolean } }) => void)({
      target: { checked: false },
    });

    // Re-render so the Start button's onClick closure captures the new
    // permadeath value. The harness preserves slot values while resetting
    // the index counter, so state survives the re-render.
    beginRender();
    tree = renderTree(
      React.createElement(SinglePlayerModal) as unknown as RenderedNode,
    );
    expect(findCheckbox(tree).props.checked).toBe(false);

    const start = findButton(tree, /start game/i);
    await (start.props.onClick as () => Promise<void> | void)?.();
    await flushAsync();

    expect(mocks.joinLobby).toHaveBeenCalledTimes(1);
    const config = (
      (mocks.joinLobby.mock.calls[0] as unknown[])[0] as {
        gameStartInfo: {
          config: { winCondition: unknown; permadeath: unknown };
        };
      }
    ).gameStartInfo.config;
    // Only `permadeath` should flip — the win condition stays Elimination.
    expect(config.winCondition).toBe(WinCondition.Elimination);
    expect(config.permadeath).toBe(false);
  });
});
