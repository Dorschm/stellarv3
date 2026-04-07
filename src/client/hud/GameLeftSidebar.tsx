import React, { useEffect, useState } from "react";
import { Colord } from "colord";
import { assetUrl } from "../../core/AssetUrls";
import { GameMode, Team } from "../../core/game/Game";
import { getTranslatedPlayerTeamLabel, translateText } from "../Utils";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import { SpawnBarVisibleEvent, ImmunityBarVisibleEvent } from "./events";
import { Platform } from "../Platform";
import { Leaderboard } from "./Leaderboard";
import { TeamStats } from "./TeamStats";

const leaderboardRegularIcon = assetUrl(
  "images/LeaderboardIconRegularWhite.svg",
);
const leaderboardSolidIcon = assetUrl("images/LeaderboardIconSolidWhite.svg");
const teamRegularIcon = assetUrl("images/TeamIconRegularWhite.svg");
const teamSolidIcon = assetUrl("images/TeamIconSolidWhite.svg");

function GameLeftSidebar(): React.JSX.Element {
  const { gameView, eventBus } = useGameView();
  const [isLeaderboardShow, setIsLeaderboardShow] = useState(false);
  const [isTeamLeaderboardShow, setIsTeamLeaderboardShow] = useState(false);
  const [isPlayerTeamLabelVisible, setIsPlayerTeamLabelVisible] = useState(false);
  const [playerTeam, setPlayerTeam] = useState<Team | null>(null);
  const [playerColor, setPlayerColor] = useState<Colord>(new Colord("#FFFFFF"));
  const [spawnBarVisible, setSpawnBarVisible] = useState(false);
  const [immunityBarVisible, setImmunityBarVisible] = useState(false);
  const [shownOnInit, setShownOnInit] = useState(false);

  const isTeamGame = gameView.config().gameConfig().gameMode === GameMode.Team;

  // Listen to bar visibility events
  useEventBus(eventBus, SpawnBarVisibleEvent, (e) => {
    setSpawnBarVisible(e.visible);
  });

  useEventBus(eventBus, ImmunityBarVisibleEvent, (e) => {
    setImmunityBarVisible(e.visible);
  });

  // Initialize
  useEffect(() => {
    if (isTeamGame) {
      setIsPlayerTeamLabelVisible(true);
    }
    // Make it visible by default on large screens
    if (Platform.isDesktopWidth) {
      setShownOnInit(true);
    }
  }, [isTeamGame]);

  // Update player team and auto-show leaderboard
  useEffect(() => {
    const myPlayer = gameView.myPlayer();
    if (!playerTeam && myPlayer?.team()) {
      const team = myPlayer.team();
      setPlayerTeam(team);
      if (team) {
        setPlayerColor(gameView.config().theme().teamColor(team));
      }
    }

    if (shownOnInit && !gameView.inSpawnPhase()) {
      setShownOnInit(false);
      setIsLeaderboardShow(true);
    }

    if (!gameView.inSpawnPhase() && isPlayerTeamLabelVisible) {
      setIsPlayerTeamLabelVisible(false);
    }
  }, [gameView, playerTeam, shownOnInit, isPlayerTeamLabelVisible]);

  const barOffset = (spawnBarVisible ? 7 : 0) + (immunityBarVisible ? 7 : 0);

  const toggleLeaderboard = () => {
    setIsLeaderboardShow(!isLeaderboardShow);
  };

  const toggleTeamLeaderboard = () => {
    setIsTeamLeaderboardShow(!isTeamLeaderboardShow);
  };

  return (
    <aside
      className={`pointer-events-auto fixed top-0 min-[1200px]:top-4 left-0 min-[1200px]:left-4 z-900 flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-br-lg ${
        isLeaderboardShow || isTeamLeaderboardShow
          ? "max-[400px]:w-full max-[400px]:rounded-none"
          : ""
      } transition-all duration-300 ease-out transform translate-x-0`}
      style={{ marginTop: `${barOffset}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-4 xl:gap-6 text-white">
        <div
          className="cursor-pointer p-0.5 bg-gray-700/50 hover:bg-gray-600 border rounded-md border-slate-500 transition-colors"
          onClick={toggleLeaderboard}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.code === "Space") {
              e.preventDefault();
              toggleLeaderboard();
            }
          }}
        >
          <img
            src={
              isLeaderboardShow
                ? leaderboardSolidIcon
                : leaderboardRegularIcon
            }
            alt={
              translateText("help_modal.icon_alt_player_leaderboard") ||
              "Player Leaderboard Icon"
            }
            width={20}
            height={20}
          />
        </div>
        {isTeamGame && (
          <div
            className="cursor-pointer p-0.5 bg-gray-700/50 hover:bg-gray-600 border rounded-md border-slate-500 transition-colors"
            onClick={toggleTeamLeaderboard}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" ||
                e.key === " " ||
                e.code === "Space"
              ) {
                e.preventDefault();
                toggleTeamLeaderboard();
              }
            }}
          >
            <img
              src={
                isTeamLeaderboardShow
                  ? teamSolidIcon
                  : teamRegularIcon
              }
              alt={
                translateText("help_modal.icon_alt_team_leaderboard") ||
                "Team Leaderboard Icon"
              }
              width={20}
              height={20}
            />
          </div>
        )}
      </div>

      {isPlayerTeamLabelVisible && (
        <div
          className="flex items-center w-full text-white mt-2"
          onContextMenu={(e) => e.preventDefault()}
        >
          {translateText("help_modal.ui_your_team")}
          <span
            style={{
              color: playerColor.toRgbString(),
            }}
          >
            &nbsp;{getTranslatedPlayerTeamLabel(playerTeam)}
            &#10687;
          </span>
        </div>
      )}

      <div
        className={`block lg:flex flex-wrap overflow-x-auto min-w-0 w-full ${
          isLeaderboardShow && isTeamLeaderboardShow ? "gap-2" : ""
        }`}
      >
        <Leaderboard visible={isLeaderboardShow} />
        <TeamStats visible={isTeamLeaderboardShow && isTeamGame} />
      </div>
    </aside>
  );
}

export { GameLeftSidebar };
export default GameLeftSidebar;
