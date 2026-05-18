import React, { useCallback, useRef, useState } from "react";
import { AllPlayers } from "../../core/game/Game";
import { Emoji, flattenedEmojiTable } from "../../core/Util";
import { useEventBus } from "../bridge/useEventBus";
import { CloseViewEvent, ShowEmojiMenuEvent } from "../InputHandler";
import { SendEmojiIntentEvent } from "../Transport";
import { useGameTick } from "./useGameTick";

export function EmojiTable(): React.JSX.Element {
  const { gameView, eventBus } = useGameTick(100);

  const [isVisible, setIsVisible] = useState(false);
  // The "emoji selected" callback is behavioral state, not render state. Keep
  // it in a ref so it never participates in rendering and can be cleared
  // deterministically when the table hides — this prevents a stale callback
  // from a previous open firing again after the menu has closed.
  const onEmojiClickedRef = useRef<((emoji: string) => void) | null>(null);

  const hideTable = useCallback(() => {
    onEmojiClickedRef.current = null;
    setIsVisible(false);
  }, []);

  const showTable = useCallback((callback: (emoji: string) => void) => {
    onEmojiClickedRef.current = callback;
    setIsVisible(true);
  }, []);

  useEventBus(eventBus, ShowEmojiMenuEvent, (e) => {
    // R3F pointer events provide tile coordinates directly.
    if (!gameView.isValidCoord(e.x, e.y)) {
      return;
    }

    const tile = gameView.ref(e.x, e.y);
    if (!gameView.hasOwner(tile)) {
      return;
    }

    const targetPlayer = gameView.owner(tile);
    // maybe redundant due to owner check but better safe than sorry
    if (!targetPlayer.isPlayer()) {
      return;
    }

    // The callback only emits the intent. Closing the menu is owned solely by
    // handleEmojiClick so the close path is single and explicit.
    showTable((emoji) => {
      const recipient =
        targetPlayer === gameView.myPlayer() ? AllPlayers : targetPlayer;
      eventBus.emit(
        new SendEmojiIntentEvent(
          recipient,
          flattenedEmojiTable.indexOf(emoji as Emoji),
        ),
      );
    });
  });

  useEventBus(eventBus, CloseViewEvent, () => {
    // hideTable() is idempotent, so no need to gate on isVisible — gating would
    // also risk acting on a stale isVisible captured by this closure.
    hideTable();
  });

  const handleBackdropClick = (e: React.MouseEvent) => {
    const panelContent = (e.currentTarget as HTMLElement).querySelector(
      'div[class*="bg-zinc-900"]',
    ) as HTMLElement;
    if (panelContent && !panelContent.contains(e.target as Node)) {
      hideTable();
    }
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    // Don't let the X click bubble into handleBackdropClick (or any other
    // map/menu logic) — just close.
    e.stopPropagation();
    hideTable();
  };

  const handleEmojiClick = (e: React.MouseEvent, emoji: string) => {
    e.stopPropagation();
    // Capture and clear the callback before invoking it so it can fire at most
    // once per open — guards against duplicate emoji intents.
    const callback = onEmojiClickedRef.current;
    onEmojiClickedRef.current = null;
    callback?.(emoji);
    // Close immediately after emitting the intent.
    hideTable();
  };

  if (!isVisible) {
    return null as any;
  }

  return (
    <div
      className="fixed inset-0 bg-black/15 backdrop-brightness-110 flex items-start sm:items-center justify-center z-[10002] pt-4 sm:pt-0"
      onClick={handleBackdropClick}
      // Pointer events inside the emoticon modal must not leak to the
      // window-level `pointerup` listener in InputHandler. A `click` and a
      // `pointerup` are separate native events, so stopping propagation only
      // on `onClick` is not enough: the close click's `pointerup` would still
      // reach InputHandler, which re-interprets it as a map click and
      // immediately reopens the emoji/context menu.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div className="relative">
        {/* Close button */}
        <button
          className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center
                    bg-zinc-700 hover:bg-red-500 text-white rounded-full shadow-sm transition-colors z-[10004]"
          onClick={handleCloseClick}
        >
          ✕
        </button>

        <div
          className="bg-zinc-900/95 p-2 sm:p-3 rounded-[10px] z-[10003] shadow-2xl shadow-black/50 ring-1 ring-white/5
                   w-[calc(100vw-32px)] sm:w-100 max-h-[calc(100vh-60px)] overflow-y-auto"
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-5 gap-1 sm:gap-2">
            {flattenedEmojiTable.map((emoji) => (
              <button
                key={emoji}
                className="flex items-center justify-center cursor-pointer aspect-square
                           border border-solid border-zinc-600 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600
                           text-3xl sm:text-4xl transition-transform duration-300 hover:scale-110 active:scale-95"
                onClick={(e) => handleEmojiClick(e, emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EmojiTable;
