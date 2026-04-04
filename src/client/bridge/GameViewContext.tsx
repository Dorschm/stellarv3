import { createContext, useContext } from "react";
import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";

/**
 * Shape of the values exposed by GameViewContext.
 *
 * `gameView` and `eventBus` are both required — the context is only provided
 * once a game session is fully initialised (i.e. after `ClientGameRunner.start()`).
 */
export interface GameViewContextValue {
  /** Live game state container – same instance the old Canvas renderer uses. */
  gameView: GameView;
  /** Shared pub/sub bus – same instance used by InputHandler / Transport. */
  eventBus: EventBus;
}

/**
 * React context that exposes the existing GameView and EventBus to the new
 * React/R3F component tree.  Initialised to `null`; consumers should use the
 * `useGameView()` hook which throws when used outside of a provider.
 */
export const GameViewContext = createContext<GameViewContextValue | null>(null);

/**
 * Convenience hook – throws a descriptive error when called outside of the
 * `<GameViewContext.Provider>`.
 */
export function useGameView(): GameViewContextValue {
  const ctx = useContext(GameViewContext);
  if (ctx === null) {
    throw new Error(
      "useGameView() must be used inside a <GameViewContext.Provider>",
    );
  }
  return ctx;
}
