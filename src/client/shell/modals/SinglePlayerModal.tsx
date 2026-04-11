import { useMemo, useState } from "react";
import { generateID } from "../../../core/Util";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  WinCondition,
} from "../../../core/game/Game";
import { genAnonUsername } from "../../AnonUsername";
import { getPlayerCosmetics } from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { aiDifficultyForWinCount, countWins } from "../../RunHistory";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useClient } from "../contexts/ClientContext";
import { useNavigation } from "../contexts/NavigationContext";

const MAPS: { type: GameMapType; label: string }[] = [
  { type: GameMapType.SolSystem, label: "Sol System" },
  { type: GameMapType.AsteroidBelt, label: "Asteroid Belt" },
  { type: GameMapType.OrionSector, label: "Orion Sector" },
  { type: GameMapType.Random, label: "Random" },
];

const DIFFICULTIES: { type: Difficulty; label: string }[] = [
  { type: Difficulty.Easy, label: "Easy" },
  { type: Difficulty.Medium, label: "Medium" },
  { type: Difficulty.Hard, label: "Hard" },
  { type: Difficulty.Impossible, label: "Impossible" },
];

export function SinglePlayerModal() {
  const { getUsernameRef, getClanTagRef, joinLobby } = useClient();
  const { showPage } = useNavigation();
  const [selectedMap, setSelectedMap] = useState<GameMapType>(
    GameMapType.SolSystem,
  );
  // GDD §10 — permadeath / roguelike mode is the default for singleplayer.
  // The AI difficulty auto-ramps with the player's historical win count via
  // `aiDifficultyForWinCount(countWins())` (from `RunHistory`). The player
  // can still override it below; the auto-ramp only supplies the initial
  // value, so an experienced player who wants an easier run can step it
  // back manually.
  const [permadeath, setPermadeath] = useState<boolean>(true);
  const wins = useMemo(() => countWins(), []);
  const suggestedDifficulty = useMemo(
    () => aiDifficultyForWinCount(wins),
    [wins],
  );
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<Difficulty>(suggestedDifficulty);
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    try {
      const clientID = generateID();
      const gameID = generateID();
      const username = getUsernameRef.current?.() ?? genAnonUsername();
      const clanTag = getClanTagRef.current?.() ?? null;
      const cosmetics = await getPlayerCosmetics();

      await crazyGamesSDK.requestMidgameAd();

      // GDD §10 — when permadeath is on we re-read the win count at start
      // time (not at mount time) so a run completed *during* the lobby
      // session is reflected in the next run's difficulty without requiring
      // a page reload. When permadeath is off the player's explicit slider
      // choice wins unconditionally.
      const effectiveDifficulty = permadeath
        ? aiDifficultyForWinCount(countWins())
        : selectedDifficulty;

      await joinLobby({
        gameID,
        source: "singleplayer",
        gameStartInfo: {
          gameID,
          players: [
            {
              clientID,
              username,
              clanTag,
              cosmetics,
            },
          ],
          config: {
            gameMap: selectedMap,
            gameMapSize: GameMapSize.Normal,
            gameType: GameType.Singleplayer,
            gameMode: GameMode.FFA,
            playerTeams: 2,
            difficulty: effectiveDifficulty,
            bots: 400,
            infiniteCredits: false,
            donateCredits: false,
            donatePopulation: false,
            infinitePopulation: false,
            instantBuild: false,
            randomSpawn: false,
            nations: "default" as const,
            disabledUnits: [],
            // GDD §1, §10 — singleplayer defaults to last-faction-standing
            // elimination, and permadeath is driven by the lobby toggle (ON
            // by default, see useState above). DefaultConfig reads both
            // fields straight from _gameConfig.
            winCondition: WinCondition.Elimination,
            permadeath,
          },
          lobbyCreatedAt: Date.now(),
          visibleAt: Date.now(),
        },
      });

      showPage("page-play");
    } catch (e) {
      console.error("Failed to start singleplayer game:", e);
      setStarting(false);
    }
  };

  return (
    <ModalPage pageId="page-single-player">
      <ModalContainer>
        <div className="p-4 lg:p-6 text-white flex flex-col gap-6 h-full overflow-y-auto">
          <h2 className="text-xl font-bold">Single Player</h2>

          {/* Map selection */}
          <div>
            <p className="text-sm text-white/60 mb-2">Map</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {MAPS.map((m) => (
                <button
                  key={m.type}
                  onClick={() => setSelectedMap(m.type)}
                  className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                    selectedMap === m.type
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Permadeath toggle — GDD §10 roguelike mode */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={permadeath}
                onChange={(e) => setPermadeath(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-white">
                Permadeath (Roguelike)
              </span>
              <span className="text-xs text-white/50">
                Wins: {wins} • AI auto-ramps
              </span>
            </label>
          </div>

          {/* Difficulty selection */}
          <div>
            <p className="text-sm text-white/60 mb-2">
              Difficulty
              {permadeath ? (
                <span className="ml-2 text-xs text-blue-300">
                  (auto from win count — uncheck Permadeath to override)
                </span>
              ) : null}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DIFFICULTIES.map((d) => {
                const isSelected = permadeath
                  ? suggestedDifficulty === d.type
                  : selectedDifficulty === d.type;
                return (
                  <button
                    key={d.type}
                    onClick={() => setSelectedDifficulty(d.type)}
                    disabled={permadeath}
                    className={`p-2 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                      isSelected
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Spacer + Start button */}
          <div className="mt-auto flex flex-col gap-3">
            <button
              onClick={handleStart}
              disabled={starting}
              className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-colors text-base"
            >
              {starting ? "Starting…" : "Start Game"}
            </button>
            <button
              onClick={() => showPage("page-play")}
              className="w-full py-2 px-4 text-white/60 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
