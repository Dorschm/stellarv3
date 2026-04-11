// Targeted coverage for the outgoing config payload the SinglePlayerModal
// sends to `joinLobby`. This test guards the GDD §1/§10 contract that every
// singleplayer run is Elimination-based and that the `permadeath` checkbox
// state is propagated verbatim into the payload. A regression that drops or
// silently flips either field will fail here before it can ship to players.

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMode,
  GameType,
  WinCondition,
} from "../../src/core/game/Game";

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

// Strip the navigation visibility gate so the modal always mounts inside the
// test harness. The real ModalPage hides children until `currentPage` matches,
// but we don't have a NavigationProvider wrapping us here.
vi.mock("../../src/client/shell/components/ModalPage", async () => {
  const reactMod = await import("react");
  return {
    ModalPage: ({
      children,
      onOpen,
    }: {
      children: React.ReactNode;
      onOpen?: () => void;
    }) => {
      reactMod.useEffect(() => {
        onOpen?.();
      }, []);
      return reactMod.createElement("div", null, children);
    },
    ModalContainer: ({ children }: { children: React.ReactNode }) =>
      reactMod.createElement("div", null, children),
  };
});

// Import after all mocks are registered so the modal picks up the fakes.
const { SinglePlayerModal } = await import(
  "../../src/client/shell/modals/SinglePlayerModal"
);

// React's production builds warn when `act(...)` runs outside an "act
// environment". Setting this flag mirrors what @testing-library would do.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Flush React updates + any microtasks queued by the awaited chain inside
// `handleStart`. The handler awaits the ad SDK, cosmetics, and joinLobby, so
// we yield a few times to let all three resolve before we assert.
async function flushAsync() {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function findButtonByText(
  container: HTMLElement,
  pattern: RegExp,
): HTMLButtonElement {
  const match = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((btn) => pattern.test(btn.textContent ?? ""));
  if (!match) {
    throw new Error(`No button matching ${pattern} in rendered modal`);
  }
  return match;
}

describe("SinglePlayerModal outgoing config payload", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.joinLobby.mockReset().mockResolvedValue(undefined);
    mocks.showPage.mockReset();
    mocks.requestMidgameAd.mockReset().mockResolvedValue(undefined);
    mocks.getPlayerCosmetics
      .mockReset()
      .mockResolvedValue({ flag: null, pattern: null });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it("starts with Elimination + permadeath enabled by default", async () => {
    root.render(React.createElement(SinglePlayerModal));
    await flushAsync();

    const checkbox = container.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    );
    expect(checkbox).not.toBeNull();
    // GDD §10 — permadeath defaults to ON for singleplayer.
    expect(checkbox!.checked).toBe(true);

    findButtonByText(container, /start game/i).click();
    await flushAsync();

    expect(mocks.joinLobby).toHaveBeenCalledTimes(1);
    const payload = mocks.joinLobby.mock.calls[0][0];
    expect(payload.source).toBe("singleplayer");

    const config = payload.gameStartInfo.config;
    expect(config.gameType).toBe(GameType.Singleplayer);
    expect(config.gameMode).toBe(GameMode.FFA);
    // GDD §1 — singleplayer is always last-faction-standing.
    expect(config.winCondition).toBe(WinCondition.Elimination);
    // GDD §10 — permadeath toggle state is propagated unchanged.
    expect(config.permadeath).toBe(true);
  });

  it("propagates a toggled-off permadeath state into the outgoing config", async () => {
    root.render(React.createElement(SinglePlayerModal));
    await flushAsync();

    const checkbox = container.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(true);

    // A native click() on a checkbox in jsdom toggles `checked` and fires
    // a bubbling change event, which is what React's onChange listens for.
    checkbox!.click();
    await flushAsync();
    expect(checkbox!.checked).toBe(false);

    findButtonByText(container, /start game/i).click();
    await flushAsync();

    expect(mocks.joinLobby).toHaveBeenCalledTimes(1);
    const config = mocks.joinLobby.mock.calls[0][0].gameStartInfo.config;
    // The win condition stays Elimination regardless of the toggle — only
    // `permadeath` should flip.
    expect(config.winCondition).toBe(WinCondition.Elimination);
    expect(config.permadeath).toBe(false);
  });
});
