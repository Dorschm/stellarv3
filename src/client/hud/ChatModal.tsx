import React, { useState } from "react";
import quickChatData from "resources/QuickChat.json" with { type: "json" };
import { PlayerType } from "../../core/game/Game";
import { PlayerView } from "../../core/game/GameView";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import { CloseViewEvent } from "../InputHandler";
import { SendQuickChatEvent } from "../Transport";
import { translateText } from "../Utils";
import { ShowChatModalEvent } from "./events";

export type QuickChatPhrase = {
  key: string;
  requiresPlayer: boolean;
};

export type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

const quickChatPhrases: QuickChatPhrases = quickChatData;

const CATEGORIES = ["help", "attack", "defend", "greet", "misc", "warnings"];

export function ChatModal(): React.JSX.Element {
  const { gameView, eventBus } = useGameView();
  const [isOpen, setIsOpen] = useState(false);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPhrase, setSelectedPhrase] = useState<QuickChatPhrase | null>(
    null,
  );
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerView | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [requiresPlayerSelection, setRequiresPlayerSelection] = useState(false);

  useEventBus(eventBus, CloseViewEvent, () => {
    if (isOpen) {
      close();
    }
  });

  // External trigger from PlayerPanel (legacy: ctModal.open(sender, recipient)).
  // We don't need to pre-select a player in the phrase flow here — the legacy
  // flow also just opened the modal; sender/recipient are informational.
  useEventBus(eventBus, ShowChatModalEvent, () => {
    open();
  });

  const getSortedFilteredPlayers = (): PlayerView[] => {
    const myPlayer = gameView.myPlayer();
    return players
      .filter((p) => {
        if (p.type() === PlayerType.Bot) return false;
        if (!p.isAlive()) return false;
        if (p.smallID() === myPlayer?.smallID()) return false;
        return p
          .displayName()
          .toLowerCase()
          .includes(playerSearchQuery.toLowerCase());
      })
      .sort((a, b) => b.population() - a.population());
  };

  const getPhrasesForCategory = (categoryId: string): QuickChatPhrase[] => {
    return (quickChatPhrases[categoryId] ?? []) as QuickChatPhrase[];
  };

  const selectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setSelectedPhrase(null);
    setPreviewText(null);
    setRequiresPlayerSelection(false);
  };

  const selectPhrase = (phrase: QuickChatPhrase) => {
    setSelectedPhrase(phrase);
    setRequiresPlayerSelection(phrase.requiresPlayer);

    const phraseText = translateText(`chat.${selectedCategory}.${phrase.key}`);
    setPreviewText(phraseText);

    if (!phrase.requiresPlayer) {
      setSelectedPlayer(null);
    }
  };

  const selectPlayer = (player: PlayerView) => {
    if (selectedPlayer?.id() === player.id()) {
      setSelectedPlayer(null);
    } else {
      setSelectedPlayer(player);
    }
  };

  const sendChatMessage = () => {
    if (!selectedPhrase || !selectedCategory) return;
    if (requiresPlayerSelection && !selectedPlayer) return;

    const fullKey = selectedPlayer
      ? `chat.${selectedCategory}.${selectedPhrase.key}.player`
      : `chat.${selectedCategory}.${selectedPhrase.key}`;

    const recipient = selectedPlayer ?? gameView.myPlayer();
    if (!recipient) return;
    eventBus.emit(
      new SendQuickChatEvent(recipient, fullKey, selectedPlayer?.id()),
    );

    close();
  };

  const open = () => {
    setIsOpen(true);
    // Fetch all active players
    const allPlayers = gameView.players();
    setPlayers(allPlayers);
  };

  const close = () => {
    setIsOpen(false);
    setSelectedCategory(null);
    setSelectedPhrase(null);
    setSelectedPlayer(null);
    setPreviewText(null);
    setPlayerSearchQuery("");
    setRequiresPlayerSelection(false);
  };

  if (!isOpen) {
    return <div />;
  }

  const filteredPlayers = getSortedFilteredPlayers();

  return (
    <div
      data-testid="chat-modal"
      className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center pointer-events-auto"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">
            {translateText("chat.title")}
          </h2>
          <button
            className="text-gray-400 hover:text-white text-xl"
            onClick={close}
          >
            ×
          </button>
        </div>

        <div className="p-4 flex gap-4">
          {/* Category column */}
          <div className="flex-1 flex flex-col">
            <div className="font-bold text-sm text-gray-300 mb-2">
              {translateText("chat.category")}
            </div>
            <div className="flex flex-col gap-1">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  className={`px-3 py-2 rounded text-left text-sm transition-colors ${
                    selectedCategory === category
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                  onClick={() => selectCategory(category)}
                >
                  {translateText(`chat.cat.${category}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Phrase column */}
          {selectedCategory && (
            <div className="flex-1 flex flex-col">
              <div className="font-bold text-sm text-gray-300 mb-2">
                {translateText("chat.phrase")}
              </div>
              <div className="flex flex-col gap-1 overflow-y-auto max-h-64">
                {getPhrasesForCategory(selectedCategory).map((phrase) => (
                  <button
                    key={phrase.key}
                    className={`px-3 py-2 rounded text-left text-sm transition-colors ${
                      selectedPhrase?.key === phrase.key
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                    onClick={() => selectPhrase(phrase)}
                  >
                    {translateText(`chat.${selectedCategory}.${phrase.key}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Player column */}
          {(requiresPlayerSelection || selectedPlayer) && (
            <div className="flex-1 flex flex-col">
              <div className="font-bold text-sm text-gray-300 mb-2">
                {translateText("chat.player")}
              </div>
              <input
                type="text"
                placeholder={translateText("chat.search")}
                className="px-3 py-2 rounded bg-gray-800 text-gray-200 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={playerSearchQuery}
                onChange={(e) => setPlayerSearchQuery(e.currentTarget.value)}
              />
              <div className="flex flex-col gap-1 overflow-y-auto max-h-64">
                {filteredPlayers.map((player) => (
                  <button
                    key={player.id()}
                    className={`px-3 py-2 rounded text-left text-sm transition-colors border-l-2 ${
                      selectedPlayer?.id() === player.id()
                        ? "bg-blue-600 text-white border-blue-400"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700 border-gray-700"
                    }`}
                    style={{
                      borderLeftColor:
                        selectedPlayer?.id() === player.id()
                          ? player.territoryColor().toHex()
                          : "transparent",
                    }}
                    onClick={() => selectPlayer(player)}
                  >
                    {player.displayName()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Preview and send */}
        <div className="border-t border-gray-700 p-4 bg-gray-850">
          <div className="mb-4 p-3 bg-gray-800 rounded text-sm text-gray-200 min-h-[3rem] flex items-center">
            {previewText
              ? translateText(previewText)
              : translateText("chat.build")}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-2 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 text-sm"
              onClick={close}
            >
              {translateText("common.cancel")}
            </button>
            <button
              className={`px-4 py-2 rounded text-sm font-medium ${
                previewText && (!requiresPlayerSelection || selectedPlayer)
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-700 text-gray-400 cursor-not-allowed"
              }`}
              disabled={
                !previewText || (requiresPlayerSelection && !selectedPlayer)
              }
              onClick={sendChatMessage}
            >
              {translateText("chat.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
