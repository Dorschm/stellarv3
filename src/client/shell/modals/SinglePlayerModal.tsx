import { useState } from "react";
import { generateID } from "../../../core/Util";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../core/game/Game";
import { getPlayerCosmetics } from "../../Cosmetics";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { genAnonUsername } from "../../AnonUsername";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useClient } from "../contexts/ClientContext";
import { useNavigation } from "../contexts/NavigationContext";

const MAPS: { type: GameMapType; label: string }[] = [
  { type: GameMapType.SolSystem, label: "Sol System" },
  { type: GameMapType.AsteroidBelt, label: "Asteroid Belt" },
  { type: GameMapType.OrionSector, label: "Orion Sector" },
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
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(
    Difficulty.Easy,
  );
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
            difficulty: selectedDifficulty,
            bots: 400,
            infiniteGold: false,
            donateGold: false,
            donateTroops: false,
            infiniteTroops: false,
            instantBuild: false,
            randomSpawn: false,
            nations: "default" as const,
            disabledUnits: [],
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

          {/* Difficulty selection */}
          <div>
            <p className="text-sm text-white/60 mb-2">Difficulty</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.type}
                  onClick={() => setSelectedDifficulty(d.type)}
                  className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedDifficulty === d.type
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {d.label}
                </button>
              ))}
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
