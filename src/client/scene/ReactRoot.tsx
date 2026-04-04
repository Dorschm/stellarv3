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
}
