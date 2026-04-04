import { useCallback, useRef, useState } from "react";
import { generateID } from "../../../core/Util";
import { getRuntimeClientServerConfig } from "../../../core/configuration/ConfigLoader";
import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
  GameMapSize,
} from "../../../core/game/Game";
import { getApiBase } from "../../Api";
import { translateText } from "../../Utils";
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

export function HostLobbyModal() {
  const { showPage } = useNavigation();
  const { joinLobby, leaveLobby } = useClient();

  const [selectedMap, setSelectedMap] = useState<GameMapType>(GameMapType.SolSystem);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(Difficulty.Medium);
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.FFA);
  const [bots, setBots] = useState(400);
  const [lobbyId, setLobbyId] = useState("");
  const [lobbyUrl, setLobbyUrl] = useState("");
  const [clients, setClients] = useState<{ username: string }[]>([]);
  const [starting, setStarting] = useState(false);
  const leaveLobbyOnCloseRef = useRef(true);

  const onOpen = useCallback(async () => {
    const gameID = generateID();
    setLobbyId(gameID);
    leaveLobbyOnCloseRef.current = true;

    // Create lobby
    const config = await getRuntimeClientServerConfig();
    const url = `/${config.workerPath(gameID)}/game/${gameID}`;
    setLobbyUrl(window.location.origin + url);

    // Join as host
    await joinLobby({
      gameID,
      source: "host",
      gameStartInfo: {
        gameID,
        players: [],
        config: {
          gameMap: selectedMap,
          gameMapSize: GameMapSize.Normal,
          gameType: GameType.Private,
          gameMode,
          playerTeams: 2,
          difficulty: selectedDifficulty,
          bots,
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
  }, [selectedMap, selectedDifficulty, gameMode, bots, joinLobby]);

  const onClose = useCallback(() => {
    if (leaveLobbyOnCloseRef.current) {
      leaveLobby();
    }
    setLobbyId("");
    setClients([]);
    setStarting(false);
  }, [leaveLobby]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(lobbyUrl);
    window.dispatchEvent(new CustomEvent("show-message", {
      detail: { message: translateText("host_lobby.url_copied"), color: "green", duration: 2000 },
    }));
  }, [lobbyUrl]);

  const handleStartGame = useCallback(async () => {
    setStarting(true);
    try {
      const res = await fetch(`${getApiBase()}/start_game/${lobbyId}`, { method: "POST" });
      if (!res.ok) {
        console.error("Failed to start game:", res.status);
        setStarting(false);
      }
      leaveLobbyOnCloseRef.current = false;
    } catch (e) {
      console.error("Failed to start game:", e);
      setStarting(false);
    }
  }, [lobbyId]);

  return (
    <ModalPage pageId="page-host-lobby" onOpen={onOpen} onClose={onClose}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("host_lobby.title")}</h2>
          {lobbyUrl && (
            <button onClick={handleCopyUrl} className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition-colors font-medium">
              {translateText("host_lobby.copy_url")}
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {/* Map selection */}
          <div>
            <p className="text-sm text-white/60 mb-2 uppercase tracking-wider">{translateText("host_lobby.map")}</p>
            <select
              value={selectedMap}
              onChange={(e) => setSelectedMap(e.target.value as GameMapType)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50"
            >
              {MAPS.map((m) => (
                <option key={m.type} value={m.type}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Difficulty */}
          <div>
            <p className="text-sm text-white/60 mb-2 uppercase tracking-wider">{translateText("host_lobby.difficulty")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DIFFICULTIES.map((d) => (
                <button key={d.type} onClick={() => setSelectedDifficulty(d.type)} className={`p-2 rounded-lg border text-sm font-medium transition-colors ${selectedDifficulty === d.type ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Game mode */}
          <div>
            <p className="text-sm text-white/60 mb-2 uppercase tracking-wider">{translateText("host_lobby.game_mode")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setGameMode(GameMode.FFA)} className={`p-2 rounded-lg border text-sm font-medium transition-colors ${gameMode === GameMode.FFA ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}>
                FFA
              </button>
              <button onClick={() => setGameMode(GameMode.Team)} className={`p-2 rounded-lg border text-sm font-medium transition-colors ${gameMode === GameMode.Team ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}>
                Teams
              </button>
            </div>
          </div>

          {/* Bots */}
          <div className="py-3 px-4 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/80 text-sm">{translateText("host_lobby.bots")}</span>
              <span className="text-white/60 text-xs">{bots}</span>
            </div>
            <input type="range" min="0" max="2000" step="50" value={bots} onChange={(e) => setBots(Number(e.target.value))} className="w-full accent-blue-500" />
          </div>

          {/* Players list */}
          {clients.length > 0 && (
            <div>
              <p className="text-sm text-white/60 mb-2 uppercase tracking-wider">{translateText("host_lobby.players")} ({clients.length})</p>
              <div className="flex flex-col gap-1">
                {clients.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-white/5 border border-white/10">
                    <span className="text-white text-sm">{c.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Start button */}
          <div className="mt-auto pt-4">
            <button
              onClick={handleStartGame}
              disabled={starting}
              className="w-full py-3 px-6 bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-colors text-base"
            >
              {starting ? translateText("host_lobby.starting") : translateText("host_lobby.start_game")}
            </button>
          </div>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
