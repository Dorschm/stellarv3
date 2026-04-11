import React, { useCallback, useState } from "react";
import { PlayerView } from "../../core/game/GameView";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import { CloseViewEvent } from "../InputHandler";
import { SendKickPlayerIntentEvent } from "../Transport";
import { translateText } from "../Utils";
import { ShowPlayerModerationModalEvent } from "./events";

export function PlayerModerationModal(): React.JSX.Element {
  const { eventBus } = useGameView();
  const [target, setTarget] = useState<PlayerView | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const isOpen = target !== null;

  const close = useCallback(() => {
    setTarget(null);
    setShowConfirm(false);
  }, []);

  useEventBus(eventBus, ShowPlayerModerationModalEvent, (e) => {
    setTarget(e.target);
    setShowConfirm(false);
  });

  useEventBus(eventBus, CloseViewEvent, () => {
    if (isOpen) close();
  });

  const handleKickConfirm = useCallback(() => {
    if (!target) return;
    eventBus.emit(new SendKickPlayerIntentEvent(target.id()));
    close();
  }, [target, eventBus, close]);

  if (!isOpen) {
    return <div />;
  }

  const confirmMessage = translateText("player_panel.kick_confirm", {
    name: target.displayName(),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-sm mx-4">
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between rounded-t-lg">
          <h2 className="text-white font-bold text-lg">
            {translateText("player_panel.moderation")}
          </h2>
          <button
            className="text-gray-400 hover:text-white text-xl leading-none"
            onClick={close}
            aria-label={translateText("common.close")}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {!showConfirm ? (
            <>
              <p className="text-gray-300 text-sm mb-4">
                <span className="text-white font-semibold">
                  {target.displayName()}
                </span>
              </p>
              <button
                className="w-full px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded text-sm font-medium transition-colors"
                onClick={() => setShowConfirm(true)}
              >
                {translateText("player_panel.kick")}
              </button>
            </>
          ) : (
            <>
              <p className="text-gray-200 text-sm mb-4 whitespace-pre-line">
                {confirmMessage}
              </p>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm transition-colors"
                  onClick={() => setShowConfirm(false)}
                >
                  {translateText("common.cancel")}
                </button>
                <button
                  className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded text-sm font-medium transition-colors"
                  onClick={handleKickConfirm}
                >
                  {translateText("player_panel.kick")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
