import React, { useEffect, useState } from "react";
import { GameType } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { translateText } from "../Utils";
import { useGameTick } from "./useGameTick";

export function HeadsUpMessage(): React.JSX.Element {
  const { gameView, tick } = useGameTick();
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isImmunityActive, setIsImmunityActive] = useState(false);
  const [isCatchingUp, setIsCatchingUp] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastColor, setToastColor] = useState<"green" | "red">("green");

  const catchingUpTicksRef = React.useRef(0);
  const toastTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const CATCHING_UP_SHOW_THRESHOLD = 10;

  // Handle custom show-message event
  useEffect(() => {
    const handleShowMessage = (event: CustomEvent) => {
      const { message, duration, color } = event.detail ?? {};
      if (typeof message === "string" || (message && typeof message === "object")) {
        setToastMessage(message);
        setToastColor(color === "red" ? "red" : "green");

        if (toastTimeoutRef.current) {
          clearTimeout(toastTimeoutRef.current);
        }

        toastTimeoutRef.current = setTimeout(
          () => {
            setToastMessage(null);
          },
          typeof duration === "number" ? duration ?? 2000 : 2000
        );
      }
    };

    window.addEventListener("show-message", handleShowMessage as EventListener);
    return () => {
      window.removeEventListener(
        "show-message",
        handleShowMessage as EventListener
      );
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updates = gameView.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.GamePaused]) {
      const pauseUpdate = updates[GameUpdateType.GamePaused][0];
      if (pauseUpdate && "paused" in pauseUpdate) {
        setIsPaused((pauseUpdate as any).paused);
      }
    }

    const showImmunityHudDuration = 10 * 10;
    const spawnEnd = gameView.config().numSpawnPhaseTurns();
    const ticksSinceSpawnEnd = gameView.ticks() - spawnEnd;

    setIsImmunityActive(
      gameView.config().hasExtendedSpawnImmunity() &&
        !gameView.inSpawnPhase() &&
        gameView.isSpawnImmunityActive() &&
        ticksSinceSpawnEnd < showImmunityHudDuration
    );

    const currentlyCatchingUp =
      !gameView.config().isReplay() && gameView.isCatchingUp();

    if (currentlyCatchingUp) {
      catchingUpTicksRef.current++;
    } else {
      catchingUpTicksRef.current = 0;
    }

    setIsCatchingUp(
      catchingUpTicksRef.current >= CATCHING_UP_SHOW_THRESHOLD
    );

    setIsVisible(
      gameView.inSpawnPhase() ||
        isPaused ||
        isImmunityActive ||
        isCatchingUp
    );
  }, [tick, gameView, isPaused, isImmunityActive, isCatchingUp]);

  const getMessage = (): string => {
    if (isCatchingUp) {
      return translateText("heads_up_message.catching_up");
    }
    if (isPaused) {
      if (gameView.config().gameConfig().gameType === GameType.Singleplayer) {
        return translateText("heads_up_message.singleplayer_game_paused");
      } else {
        return translateText("heads_up_message.multiplayer_game_paused");
      }
    }
    if (isImmunityActive) {
      return translateText("heads_up_message.pvp_immunity_active", {
        seconds: Math.round(gameView.config().spawnImmunityDuration() / 10),
      });
    }
    return gameView.config().isRandomSpawn()
      ? translateText("heads_up_message.random_spawn")
      : translateText("heads_up_message.choose_spawn");
  };

  return (
    <div style={{ pointerEvents: "none" }}>
      {toastMessage ? (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[800] px-6 py-4 rounded-xl transition-all duration-300 animate-fade-in-out"
          style={{
            maxWidth: "90vw",
            minWidth: "200px",
            textAlign: "center",
            background:
              toastColor === "red"
                ? "rgba(239,68,68,0.1)"
                : "rgba(34,197,94,0.1)",
            border:
              toastColor === "red"
                ? "1px solid rgba(239,68,68,0.5)"
                : "1px solid rgba(34,197,94,0.5)",
            color: "white",
            boxShadow:
              toastColor === "red"
                ? "0 0 30px 0 rgba(239,68,68,0.3)"
                : "0 0 30px 0 rgba(34,197,94,0.3)",
            backdropFilter: "blur(12px)",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="font-medium">{toastMessage}</span>
        </div>
      ) : null}

      {isVisible ? (
        <div
          className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[799] inline-flex items-center justify-center min-h-8 lg:min-h-10 w-fit max-w-[90vw] bg-gray-800/70 rounded-md lg:rounded-lg backdrop-blur-xs text-white text-md lg:text-xl px-3 lg:px-4 py-1 text-center break-words"
          style={{
            wordWrap: "break-word",
            hyphens: "auto",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {getMessage()}
        </div>
      ) : null}
    </div>
  );
}

export default HeadsUpMessage;
