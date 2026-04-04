import React, { useEffect, useState } from "react";
import { GameMode } from "../../core/game/Game";
import { useGameTick } from "./useGameTick";
import { useEventBus } from "../bridge/useEventBus";
import { ImmunityBarVisibleEvent, SpawnBarVisibleEvent } from "./events";

export function ImmunityTimer(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick();
  const [isActive, setIsActive] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const [barOffset, setBarOffset] = useState(0);
  const [previousBarVisible, setPreviousBarVisible] = useState(false);

  // Listen to spawn bar visibility to adjust position
  useEventBus(eventBus, SpawnBarVisibleEvent, (event) => {
    setPreviousBarVisible(event.visible);
    setBarOffset(event.visible ? 7 : 0);
  });

  useEffect(() => {
    const showTeamOwnershipBar =
      gameView.config().gameConfig().gameMode === GameMode.Team &&
      !gameView.inSpawnPhase();

    const offset = showTeamOwnershipBar ? 7 : 0;
    setBarOffset(offset);
  }, [tick, gameView]);

  useEffect(() => {
    const immunityDuration = gameView.config().spawnImmunityDuration();
    const spawnPhaseTurns = gameView.config().numSpawnPhaseTurns();

    if (
      !gameView.config().hasExtendedSpawnImmunity() ||
      gameView.inSpawnPhase()
    ) {
      setIsActive(false);
    } else {
      const immunityEnd = spawnPhaseTurns + immunityDuration;
      const ticks = gameView.ticks();

      if (ticks >= immunityEnd || ticks < spawnPhaseTurns) {
        setIsActive(false);
      } else {
        const elapsedTicks = Math.max(0, ticks - spawnPhaseTurns);
        const ratio = Math.min(1, Math.max(0, elapsedTicks / immunityDuration));
        setProgressRatio(ratio);
        setIsActive(true);
      }
    }
  }, [tick, gameView]);

  // Emit bar visibility event
  useEffect(() => {
    eventBus.emit(new ImmunityBarVisibleEvent(isActive));
  }, [isActive, eventBus]);

  if (!isActive) {
    return <></>;
  }

  const widthPercent = progressRatio * 100;

  return (
    <div
      className="w-full h-[7px] flex z-999 fixed left-0 pointer-events-none"
      style={{
        top: `${barOffset}px`,
      }}
    >
      <div
        className="h-full transition-all duration-100 ease-in-out"
        style={{
          width: `${widthPercent}%`,
          backgroundColor: "rgba(255, 165, 0, 0.9)",
        }}
      />
    </div>
  );
}

export default ImmunityTimer;
