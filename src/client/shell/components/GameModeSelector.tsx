import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeClientServerConfig } from "../../../core/configuration/ConfigLoader";
import {
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../../../core/game/Game";
import type { PublicGameInfo, PublicGames } from "../../../core/Schemas";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { PublicLobbySocket } from "../../LobbySocket";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import {
  calculateServerTimeOffset,
  getMapName,
  getModifierLabels,
  getSecondsUntilServerTimestamp,
  renderDuration,
  translateText,
} from "../../Utils";
import { useClient } from "../contexts/ClientContext";
import { useNavigation } from "../contexts/NavigationContext";

const CARD_BG = "bg-sky-950";

export function GameModeSelector() {
  const { showPage } = useNavigation();
  const { getValidateUsernameRef, joinLobby } = useClient();
  const [lobbies, setLobbies] = useState<PublicGames | null>(null);
  const [mapAspectRatios, setMapAspectRatios] = useState<
    Map<GameMapType, number>
  >(new Map());
  const serverTimeOffsetRef = useRef(0);
  const defaultLobbyTimeRef = useRef(0);
  const socketRef = useRef<PublicLobbySocket | null>(null);

  const validateUsername = useCallback((): boolean => {
    const validate = getValidateUsernameRef.current;
    return validate ? validate() : true;
  }, [getValidateUsernameRef]);

  // Start lobby socket on mount
  useEffect(() => {
    const socket = new PublicLobbySocket((data: PublicGames) => {
      setLobbies(data);
      serverTimeOffsetRef.current = calculateServerTimeOffset(data.serverTime);
      document.dispatchEvent(
        new CustomEvent("public-lobbies-update", {
          detail: { payload: data },
        }),
      );

      const allGames = Object.values(data.games ?? {}).flat();
      setMapAspectRatios((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const game of allGames) {
          const mapType = game.gameConfig?.gameMap as GameMapType;
          if (mapType && !next.has(mapType)) {
            changed = true;
            next.set(mapType, 1);
            terrainMapFileLoader
              .getMapData(mapType)
              .manifest()
              .then((m: any) => {
                if (m?.map?.width && m?.map?.height) {
                  setMapAspectRatios((p) =>
                    new Map(p).set(mapType, m.map.width / m.map.height),
                  );
                }
              })
              .catch(() => {});
          }
        }
        return changed ? next : prev;
      });
    });
    socketRef.current = socket;
    socket.start();

    getRuntimeClientServerConfig().then((config) => {
      defaultLobbyTimeRef.current = config.gameCreationRate() / 1000;
    });

    return () => {
      socket.stop();
    };
  }, []);

  // Expose stop method for ClientContext to call during game prestart
  useEffect(() => {
    const handler = () => socketRef.current?.stop();
    document.addEventListener("stop-game-mode-selector", handler);
    return () =>
      document.removeEventListener("stop-game-mode-selector", handler);
  }, []);

  const openSinglePlayer = useCallback(() => {
    if (!validateUsername()) return;
    showPage("page-single-player");
  }, [validateUsername, showPage]);

  const openHostLobby = useCallback(() => {
    if (!validateUsername()) return;
    showPage("page-host-lobby");
  }, [validateUsername, showPage]);

  const openJoinLobby = useCallback(() => {
    if (!validateUsername()) return;
    showPage("page-join-lobby");
  }, [validateUsername, showPage]);

  const openRankedMenu = useCallback(() => {
    if (!validateUsername()) return;
    showPage("page-ranked");
  }, [validateUsername, showPage]);

  const validateAndJoin = useCallback(
    (lobby: PublicGameInfo) => {
      if (!validateUsername()) return;
      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: lobby.gameID,
            source: "public",
            publicLobbyInfo: lobby,
          },
          bubbles: true,
          composed: true,
        }),
      );
    },
    [validateUsername],
  );

  const getLobbyTitle = useCallback((lobby: PublicGameInfo): string => {
    const config = lobby.gameConfig!;
    if (config.gameMode === GameMode.FFA) {
      return translateText("game_mode.ffa");
    }

    if (config?.gameMode === GameMode.Team) {
      const totalPlayers = config.maxPlayers ?? lobby.numClients ?? undefined;
      const formatTeamsOf = (
        teamCount: number | undefined,
        playersPerTeam: number | undefined,
        label?: string,
      ) => {
        if (!teamCount)
          return label ?? translateText("mode_selector.teams_title");
        const baseTitle = playersPerTeam
          ? translateText("mode_selector.teams_of", {
              teamCount: String(teamCount),
              playersPerTeam: String(playersPerTeam),
            })
          : translateText("mode_selector.teams_count", {
              teamCount: String(teamCount),
            });
        return `${baseTitle}${label ? ` (${label})` : ""}`;
      };

      switch (config.playerTeams) {
        case Duos: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 2)
            : undefined;
          return formatTeamsOf(teamCount, 2);
        }
        case Trios: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 3)
            : undefined;
          return formatTeamsOf(teamCount, 3);
        }
        case Quads: {
          const teamCount = totalPlayers
            ? Math.floor(totalPlayers / 4)
            : undefined;
          return formatTeamsOf(teamCount, 4);
        }
        case HumansVsNations: {
          const humanSlots = config.maxPlayers ?? lobby.numClients;
          return humanSlots
            ? translateText("public_lobby.teams_hvn_detailed", {
                num: String(humanSlots),
              })
            : translateText("public_lobby.teams_hvn");
        }
        default:
          if (typeof config.playerTeams === "number") {
            const teamCount = config.playerTeams;
            const playersPerTeam =
              totalPlayers && teamCount > 0
                ? Math.floor(totalPlayers / teamCount)
                : undefined;
            return formatTeamsOf(teamCount, playersPerTeam);
          }
      }
    }

    return "";
  }, []);

  const renderSmallActionCard = (
    title: string,
    onClick: () => void,
    bgClass: string = CARD_BG,
  ) => (
    <button
      onClick={onClick}
      className={`flex items-center justify-center w-full h-full rounded-lg ${bgClass} transition-colors text-sm lg:text-base font-medium text-white uppercase tracking-wider text-center`}
    >
      {title}
    </button>
  );

  const renderLobbyCard = (lobby: PublicGameInfo, titleContent: string) => {
    const mapType = lobby.gameConfig!.gameMap as GameMapType;
    const mapImageSrc = terrainMapFileLoader.getMapData(mapType).webpPath;
    const aspectRatio = mapAspectRatios.get(mapType);
    const useContain =
      aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25);
    const timeRemaining = lobby.startsAt
      ? getSecondsUntilServerTimestamp(
          lobby.startsAt,
          serverTimeOffsetRef.current,
        )
      : undefined;

    let timeDisplay = "";
    let timeDisplayUppercase = false;
    if (timeRemaining === undefined) {
      timeDisplay = renderDuration(defaultLobbyTimeRef.current);
    } else if (timeRemaining > 0) {
      timeDisplay = renderDuration(timeRemaining);
    } else {
      timeDisplay = translateText("public_lobby.starting_game");
      timeDisplayUppercase = true;
    }

    const mapName = getMapName(lobby.gameConfig?.gameMap);
    const modifierLabels = getModifierLabels(
      lobby.gameConfig?.publicGameModifiers,
    );
    if (modifierLabels.length > 1) {
      modifierLabels.sort((a, b) => a.length - b.length);
    }

    return (
      <button
        onClick={() => validateAndJoin(lobby)}
        className="group relative w-full h-44 sm:h-full text-white uppercase rounded-2xl transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] bg-sky-950"
      >
        <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
          {mapImageSrc && (
            <img
              src={mapImageSrc}
              alt={mapName ?? lobby.gameConfig?.gameMap ?? "map"}
              draggable={false}
              className={`absolute inset-0 w-full h-full ${
                useContain
                  ? "object-contain"
                  : "object-cover object-center scale-[1.05]"
              } [image-rendering:auto]`}
            />
          )}
        </div>
        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          {modifierLabels.length > 0 ? (
            <div className="flex flex-col items-start gap-1 mt-[2px]">
              {modifierLabels.map((label, i) => (
                <span
                  key={i}
                  className="px-2 py-1 rounded text-xs font-bold uppercase tracking-widest bg-sky-600 text-white shadow-[0_0_6px_rgba(14,165,233,0.35)]"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <div />
          )}
          <div className="shrink-0">
            <span
              className={`text-xs font-bold tracking-widest ${
                timeDisplayUppercase ? "uppercase" : "normal-case"
              } bg-sky-600 text-white px-2 py-1 rounded`}
            >
              {timeDisplay}
            </span>
          </div>
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 flex flex-col px-3 py-2 bg-black/55 backdrop-blur-sm rounded-b-2xl"
          style={{ overflow: "visible" }}
        >
          <span className="absolute bottom-full right-2 mb-1 flex items-center gap-1 text-xs font-bold tracking-widest bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded">
            {lobby.numClients}/{lobby.gameConfig?.maxPlayers}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 inline-block"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
            </svg>
          </span>
          {mapName && (
            <p className="text-sm sm:text-base font-bold uppercase tracking-wider text-left leading-tight">
              {mapName}
            </p>
          )}
          <h3 className="text-xs text-white/70 uppercase tracking-wider text-left">
            {titleContent}
          </h3>
        </div>
      </button>
    );
  };

  const ffa = lobbies?.games?.["ffa"]?.[0];
  const teams = lobbies?.games?.["team"]?.[0];
  const special = lobbies?.games?.["special"]?.[0];

  return (
    <div className="flex flex-col gap-4 w-full px-4 sm:px-0 mx-auto pb-4 sm:pb-0">
      {/* Solo: mobile only, top */}
      <div className="sm:hidden h-14">
        {renderSmallActionCard(
          translateText("main.solo"),
          openSinglePlayer,
          "bg-sky-600 hover:bg-sky-500 active:bg-sky-700",
        )}
      </div>
      {/* Create/ranked/join: mobile only */}
      <div className="sm:hidden grid grid-cols-3 gap-4 h-14">
        {renderSmallActionCard(
          translateText("main.create"),
          openHostLobby,
          "bg-slate-600 hover:bg-slate-500 active:bg-slate-700",
        )}
        {!crazyGamesSDK.isOnCrazyGames() ? (
          renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            openRankedMenu,
            "bg-slate-600 hover:bg-slate-500 active:bg-slate-700",
          )
        ) : (
          <div className="invisible" />
        )}
        {renderSmallActionCard(
          translateText("main.join"),
          openJoinLobby,
          "bg-slate-600 hover:bg-slate-500 active:bg-slate-700",
        )}
      </div>
      {/* Game cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4 sm:h-[min(24rem,40vh)]">
        {ffa && (
          <div className="hidden sm:block">
            {renderLobbyCard(ffa, getLobbyTitle(ffa))}
          </div>
        )}
        <div className="hidden sm:flex sm:flex-col sm:gap-4">
          {special && (
            <div className="flex-1 min-h-0">
              {renderLobbyCard(special, getLobbyTitle(special))}
            </div>
          )}
          {teams && (
            <div className="flex-1 min-h-0">
              {renderLobbyCard(teams, getLobbyTitle(teams))}
            </div>
          )}
        </div>
        {/* Mobile: inline cards */}
        <div className="sm:hidden">
          {special && renderLobbyCard(special, getLobbyTitle(special))}
        </div>
        <div className="sm:hidden">
          {ffa && renderLobbyCard(ffa, getLobbyTitle(ffa))}
        </div>
        <div className="sm:hidden">
          {teams && renderLobbyCard(teams, getLobbyTitle(teams))}
        </div>
      </div>
      {/* Solo: desktop only */}
      <div className="hidden sm:block h-14">
        {renderSmallActionCard(
          translateText("main.solo"),
          openSinglePlayer,
          "bg-sky-600 hover:bg-sky-500 active:bg-sky-700",
        )}
      </div>
      {/* Bottom row: create + ranked + join (desktop only) */}
      <div className="hidden sm:grid grid-cols-3 gap-4 h-14">
        {renderSmallActionCard(
          translateText("main.create"),
          openHostLobby,
          "bg-slate-600 hover:bg-slate-500 active:bg-slate-700",
        )}
        {!crazyGamesSDK.isOnCrazyGames() ? (
          renderSmallActionCard(
            translateText("mode_selector.ranked_title"),
            openRankedMenu,
            "bg-slate-600 hover:bg-slate-500 active:bg-slate-700",
          )
        ) : (
          <div className="invisible" />
        )}
        {renderSmallActionCard(
          translateText("main.join"),
          openJoinLobby,
          "bg-slate-600 hover:bg-slate-500 active:bg-slate-700",
        )}
      </div>
    </div>
  );
}
