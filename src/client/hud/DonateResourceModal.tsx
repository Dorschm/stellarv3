import React, { useState } from "react";
import { PlayerView } from "../../core/game/GameView";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import { CloseViewEvent } from "../InputHandler";
import {
  SendDonateCreditsIntentEvent,
  SendDonatePopulationIntentEvent,
} from "../Transport";
import { translateText } from "../Utils";
import { ShowDonateResourceModalEvent } from "./events";

export function DonateResourceModal(): React.JSX.Element {
  const { gameView, eventBus } = useGameView();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"population" | "credits">("population");
  const [target, setTarget] = useState<PlayerView | null>(null);
  const [amount, setAmount] = useState(0);
  const [max, setMax] = useState(0);

  useEventBus(eventBus, CloseViewEvent, () => {
    if (isOpen) close();
  });

  useEventBus(eventBus, ShowDonateResourceModalEvent, (e) => {
    const myPlayer = gameView.myPlayer();
    if (!myPlayer) return;

    const available =
      e.mode === "population"
        ? myPlayer.population()
        : Number(myPlayer.credits());
    const maxVal = Math.floor(available);

    setMode(e.mode);
    setTarget(e.target);
    setMax(maxVal);
    setAmount(maxVal > 0 ? 1 : 0);
    setIsOpen(true);
  });

  const close = () => {
    setIsOpen(false);
    setTarget(null);
    setAmount(0);
    setMax(0);
  };

  const confirm = () => {
    if (!target || amount < 1 || amount > max) return;
    if (mode === "population") {
      eventBus.emit(new SendDonatePopulationIntentEvent(target, amount));
    } else {
      eventBus.emit(new SendDonateCreditsIntentEvent(target, BigInt(amount)));
    }
    close();
  };

  const handleInputChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      setAmount(0);
    } else {
      setAmount(Math.max(0, Math.min(parsed, max)));
    }
  };

  if (!isOpen || !target) {
    return <div />;
  }

  const canSend = amount >= 1 && amount <= max;
  const label = mode === "population" ? "Population" : "Credits";

  return (
    <div
      data-testid="donate-resource-modal"
      className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center pointer-events-auto"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between rounded-t-lg">
          <h2 className="text-white font-bold text-lg">Send {label}</h2>
          <button
            className="text-gray-400 hover:text-white text-xl"
            onClick={close}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <p className="text-gray-300 text-sm mb-4">
            To:{" "}
            <span className="text-white font-medium">
              {target.displayName()}
            </span>
          </p>

          <div className="mb-2">
            <div className="flex justify-between text-sm text-gray-400 mb-1">
              <span>Amount</span>
              <span>Available: {max.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={1}
              max={Math.max(max, 1)}
              value={amount}
              disabled={max < 1}
              onChange={(e) => setAmount(Number(e.currentTarget.value))}
              className="w-full accent-blue-500"
            />
            <input
              type="number"
              min={1}
              max={max}
              value={amount === 0 ? "" : amount}
              onChange={(e) => handleInputChange(e.currentTarget.value)}
              className="mt-2 w-full px-3 py-2 rounded bg-gray-800 text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 p-4 flex gap-2 justify-end">
          <button
            className="px-4 py-2 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 text-sm"
            onClick={close}
          >
            {translateText("common.cancel")}
          </button>
          <button
            className={`px-4 py-2 rounded text-sm font-medium ${
              canSend
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-700 text-gray-400 cursor-not-allowed"
            }`}
            disabled={!canSend}
            onClick={confirm}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
