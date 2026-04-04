import React, { useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { GameType } from "../../core/game/Game";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { TogglePauseIntentEvent } from "../InputHandler";
import { PauseGameIntentEvent, SendWinnerEvent } from "../Transport";
import { translateText } from "../Utils";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import {
  ImmunityBarVisibleEvent,
  SpawnBarVisibleEvent,
  ShowReplayPanelEvent,
  ShowSettingsModalEvent,
} from "./events";

const exitIcon = assetUrl("images/ExitIconWhite.svg");
const FastForwardIconSolid = assetUrl("images/FastForwardIconSolidWhite.svg");
const pauseIcon = assetUrl("images/PauseIconWhite.svg");
const playIcon = assetUrl("images/PlayIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");

function GameRightSidebar(): React.JSX.Element {
  const { gameView, eventBus } = useGameView();
  const [isSinglePlayer, setIsSinglePlayer] = useState(false);
  const [isReplayVisible, setIsReplayVisible] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [timer, setTimer] = useState(0);
  const [hasWinner, setHasWinner] = useState(false);
  const [isLobbyCreator, setIsLobbyCreator] = useState(false);
  const [spawnBarVisible, setSpawnBarVisible] = useState(false);
  const [immunityBarVisible, setImmunityBarVisible] = useState(false);

  // Initialize
  useEffect(() => {
    const isSP =
      gameView.config().gameConfig().gameType === GameType.Singleplayer ||
      gameView.config().isReplay();
    setIsSinglePlayer(isSP);
    setIsVisible(true);
  }, [gameView]);

  // Listen to events
  useEventBus(eventBus, SpawnBarVisibleEvent, (e) => {
    setSpawnBarVisible(e.visible);
    updateParentOffset(e.visible, immunityBarVisible);
  });

  useEventBus(eventBus, ImmunityBarVisibleEvent, (e) => {
    setImmunityBarVisible(e.visible);
    updateParentOffset(spawnBarVisible, e.visible);
  });

  useEventBus(eventBus, SendWinnerEvent, () => {
    setHasWinner(true);
  });

  useEventBus(eventBus, TogglePauseIntentEvent, () => {
    const isReplayOrSingleplayer = isSinglePlayer || gameView.config().isReplay();
    if (isReplayOrSingleplayer || isLobbyCreator) {
      onPauseButtonClick();
    }
  });

  // Timer update - tick every 250ms
  useEffect(() => {
    const interval = setInterval(() => {
      if (!gameView) return;

      // Check if the player is the lobby creator
      if (!isLobbyCreator && gameView.myPlayer()?.isLobbyCreator()) {
        setIsLobbyCreator(true);
      }

      const maxTimerValue = gameView.config().gameConfig().maxTimerValue;
      const spawnPhaseTurns = gameView.config().numSpawnPhaseTurns();
      const ticks = gameView.ticks();
      const gameTicks = Math.max(0, ticks - spawnPhaseTurns);
      const elapsedSeconds = Math.floor(gameTicks / 10); // 10 ticks per second

      if (gameView.inSpawnPhase()) {
        setTimer(maxTimerValue !== undefined ? maxTimerValue * 60 : 0);
        return;
      }

      if (hasWinner) {
        return;
      }

      if (maxTimerValue !== undefined) {
        setTimer(Math.max(0, maxTimerValue * 60 - elapsedSeconds));
      } else {
        setTimer(elapsedSeconds);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [gameView, hasWinner, isLobbyCreator]);

  const updateParentOffset = (spawn: boolean, immunity: boolean) => {
    const offset = (spawn ? 7 : 0) + (immunity ? 7 : 0);
    const parent = document.querySelector(
      ".flex.flex-col.items-end.fixed.top-0.right-0",
    ) as HTMLElement;
    if (parent) {
      parent.style.marginTop = `${offset}px`;
    }
  };

  const secondsToHms = (d: number): string => {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);

    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);

    if (h !== 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    } else {
      return `${pad(m)}:${pad(s)}`;
    }
  };

  const toggleReplayPanel = () => {
    const newVisible = !isReplayVisible;
    setIsReplayVisible(newVisible);
    eventBus.emit(new ShowReplayPanelEvent(newVisible, isSinglePlayer));
  };

  const onPauseButtonClick = () => {
    const newPaused = !isPaused;
    setIsPaused(newPaused);
    if (newPaused) {
      crazyGamesSDK.gameplayStop();
    } else {
      crazyGamesSDK.gameplayStart();
    }
    eventBus.emit(new PauseGameIntentEvent(newPaused));
  };

  const onExitButtonClick = async () => {
    const isAlive = gameView.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    await crazyGamesSDK.requestMidgameAd();
    await crazyGamesSDK.gameplayStop();
    // redirect to the home page
    window.location.href = "/";
  };

  const onSettingsButtonClick = () => {
    eventBus.emit(
      new ShowSettingsModalEvent(true, isSinglePlayer, isPaused),
    );
  };

  const timerColor =
    gameView.config().gameConfig().maxTimerValue !== undefined && timer < 60
      ? "text-red-400"
      : "";

  const isReplayOrSingleplayer = isSinglePlayer || gameView.config().isReplay();
  const showPauseButton = isReplayOrSingleplayer || isLobbyCreator;

  return (
    <aside
      className={`w-fit flex flex-row items-center gap-3 py-2 px-3 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg transition-transform duration-300 ease-out transform text-white ${
        isVisible ? "translate-x-0" : "translate-x-full"
      }`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* In-game time */}
      <div className={timerColor}>{secondsToHms(timer)}</div>

      {/* Buttons */}
      {isReplayOrSingleplayer && (
        <div
          className="cursor-pointer"
          onClick={toggleReplayPanel}
        >
          <img
            src={FastForwardIconSolid}
            alt="replay"
            width={20}
            height={20}
          />
        </div>
      )}

      {showPauseButton && (
        <div className="cursor-pointer" onClick={onPauseButtonClick}>
          <img
            src={isPaused ? playIcon : pauseIcon}
            alt="play/pause"
            width={20}
            height={20}
          />
        </div>
      )}

      <div className="cursor-pointer" onClick={onSettingsButtonClick}>
        <img src={settingsIcon} alt="settings" width={20} height={20} />
      </div>

      <div className="cursor-pointer" onClick={onExitButtonClick}>
        <img src={exitIcon} alt="exit" width={20} height={20} />
      </div>
    </aside>
  );
}

export { GameRightSidebar };
export default GameRightSidebar;
