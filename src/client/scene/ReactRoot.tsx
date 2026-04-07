import { createRoot, Root } from "react-dom/client";
import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { UserSettings } from "../../core/game/UserSettings";
import { GameViewContext } from "../bridge/GameViewContext";
import {
  TransformContext,
  TransformContextValue,
} from "../hud/TransformContext";
import { HUDOverlay } from "../hud/HUDOverlay";
import { SpaceScene } from "./SpaceScene";
import {
  MouseUpEvent,
  MouseDownEvent,
  ContextMenuEvent,
  CloseViewEvent,
} from "../InputHandler";

/** Persistent handle so we can unmount cleanly when the game ends. */
let reactRoot: Root | null = null;

/**
 * Mount the React/R3F scene + HUD into `#react-root`.
 *
 * This is the **primary** rendering path — there is no Canvas 2D fallback.
 * The React tree receives game state via the GameBridge Zustand store.
 *
 * Safe to call multiple times — subsequent calls are no-ops if the root
 * already exists.  Call {@link unmountReactRoot} to tear down.
 */
export function mountReactRoot(gameView: GameView, eventBus: EventBus): void {
  if (reactRoot !== null) {
    console.warn("[ReactRoot] already mounted — skipping");
    return;
  }

  // Use the existing #react-root from index.html, or create if missing.
  let container = document.getElementById("react-root");
  if (!container) {
    container = document.createElement("div");
    container.id = "react-root";
    document.body.appendChild(container);
  }
  // Ensure the container is styled for overlay use.
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.overflow = "visible";
  container.style.zIndex = "10";
  container.style.pointerEvents = "none";

  const transformCtx: TransformContextValue = {
    userSettings: new UserSettings(),
  };

  reactRoot = createRoot(container);
  reactRoot.render(
    <GameViewContext.Provider value={{ gameView, eventBus }}>
      <TransformContext.Provider value={transformCtx}>
        <SpaceScene />
        <HUDOverlay />
      </TransformContext.Provider>
    </GameViewContext.Provider>,
  );

  // Expose the active GameView and EventBus on `window` for Playwright
  // E2E tests so specs can call `window.__gameView.ticks()` for read-only
  // assertions and `window.__eventBus.emit(...)` for triggering game
  // events when canvas pointer delivery is unreliable.
  // Only attached in non-prod to keep production bundles free of this
  // debug surface.
  if (process.env.GAME_ENV !== "prod") {
    const w = window as unknown as {
      __gameView: GameView;
      __eventBus: EventBus;
      __emitClick: (tileX: number, tileY: number) => void;
      __emitRightClick: (
        tileX: number,
        tileY: number,
        clientX: number,
        clientY: number,
      ) => void;
      __emitMouseDown: (tileX: number, tileY: number) => void;
      __closeMenus: () => void;
    };
    w.__gameView = gameView;
    w.__eventBus = eventBus;
    w.__emitClick = (tileX: number, tileY: number) => {
      eventBus.emit(new MouseUpEvent(tileX, tileY, true));
    };
    w.__emitRightClick = (
      tileX: number,
      tileY: number,
      clientX: number,
      clientY: number,
    ) => {
      eventBus.emit(new ContextMenuEvent(tileX, tileY, true, clientX, clientY));
    };
    w.__emitMouseDown = (tileX: number, tileY: number) => {
      eventBus.emit(new MouseDownEvent(tileX, tileY));
    };
    w.__closeMenus = () => {
      eventBus.emit(new CloseViewEvent());
    };
  }

  console.log("[ReactRoot] mounted as primary rendering path");
}

/**
 * Unmount the React tree (e.g. when leaving a game session).
 */
export function unmountReactRoot(): void {
  if (reactRoot !== null) {
    reactRoot.unmount();
    reactRoot = null;
    console.log("[ReactRoot] unmounted");
  }

  const container = document.getElementById("react-root");
  if (container) {
    container.remove();
  }

  // Remove the E2E test hooks so tests can detect a fresh mount next game.
  if (process.env.GAME_ENV !== "prod") {
    const w = window as unknown as {
      __gameView?: unknown;
      __eventBus?: unknown;
      __emitClick?: unknown;
      __emitRightClick?: unknown;
      __emitMouseDown?: unknown;
      __closeMenus?: unknown;
    };
    delete w.__gameView;
    delete w.__eventBus;
    delete w.__emitClick;
    delete w.__emitRightClick;
    delete w.__emitMouseDown;
    delete w.__closeMenus;
  }
}
