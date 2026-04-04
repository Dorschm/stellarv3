import React, { useEffect, useState } from "react";
import { GameMode, Team } from "../../core/game/Game";
import { useGameTick } from "./useGameTick";
import { useEventBus } from "../bridge/useEventBus";
import { SpawnBarVisibleEvent } from "./events";

export function SpawnTimer(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick();
  const [ratios, setRatios] = useState<number[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [barVisible, setBarVisible] = useState(false);

  useEffect(() => {
    if (gameView.inSpawnPhase()) {
      // During spawn phase, only one segment filling full width
      setRatios([gameView.ticks() / gameView.config().numSpawnPhaseTurns()]);
      setColors(["rgba(0, 128, 255, 0.7)"]);
    } else {
      const newRatios: number[] = [];
      const newColors: string[] = [];

      if (gameView.config().gameConfig().gameMode === GameMode.Team) {
        const teamTiles = new Map<Team, number>();
        for (const player of gameView.players()) {
          const team = player.team();
          if (team === null) continue;
          const tiles = teamTiles.get(team) ?? 0;
          teamTiles.set(team, tiles + player.numTilesOwned());
        }

        const theme = gameView.config().theme();
        let total = 0;
        for (const count of teamTiles.values()) {
          total += count;
        }

        if (total > 0) {
          for (const [team, count] of teamTiles) {
            const ratio = count / total;
            newRatios.push(ratio);
            newColors.push(theme.teamColor(team).toRgbString());
          }
        }
      }

      setRatios(newRatios);
      setColors(newColors);
    }
  }, [tick, gameView]);

  // Emit bar visibility event when visibility changes
  useEffect(() => {
    const nowVisible = ratios.length > 0;
    if (nowVisible !== barVisible) {
      setBarVisible(nowVisible);
      eventBus.emit(new SpawnBarVisibleEvent(nowVisible));
    }
  }, [ratios, barVisible, eventBus]);

  if (ratios.length === 0 || colors.length === 0) {
    return <></>;
  }

  if (
    !gameView.inSpawnPhase() &&
    gameView.config().gameConfig().gameMode !== GameMode.Team
  ) {
    return <></>;
  }

  return (
    <div className="w-full h-[7px] flex z-999 fixed top-0 left-0 pointer-events-none">
      {ratios.map((ratio, i) => {
        const color = colors[i] || "rgba(0, 0, 0, 0.5)";
        return (
          <div
            key={i}
            className="h-full transition-all duration-100 ease-in-out"
            style={{
              width: `${ratio * 100}%`,
              backgroundColor: color,
            }}
          />
        );
      })}
    </div>
  );
}

export default SpawnTimer;
