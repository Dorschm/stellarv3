import React, { useEffect, useState } from "react";
import { PlayerView } from "../../core/game/GameView";
import {
  formatPercentage,
  renderNumber,
  renderTroops,
  translateText,
} from "../Utils";
import { GoToPlayerEvent } from "./events";
import { useGameTick } from "./useGameTick";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
  player: PlayerView;
}

interface LeaderboardProps {
  visible: boolean;
}

function Leaderboard({ visible }: LeaderboardProps): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick(1000);
  const [players, setPlayers] = useState<Entry[]>([]);
  const [sortKey, setSortKey] = useState<"tiles" | "gold" | "maxtroops">(
    "tiles",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showTopFive, setShowTopFive] = useState(true);

  // Update leaderboard data
  useEffect(() => {
    if (!visible || !gameView) return;
    updateLeaderboard();
  }, [visible, gameView, sortKey, sortOrder, tick]);

  const updateLeaderboard = () => {
    if (!gameView) throw new Error("Not initialized");
    const myPlayer = gameView.myPlayer();
    let sorted = gameView.playerViews();

    const compare = (a: number, b: number) =>
      sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => gameView.config().maxTroops(p);

    switch (sortKey) {
      case "gold":
        sorted = sorted.sort((a, b) =>
          compare(Number(a.credits()), Number(b.credits())),
        );
        break;
      case "maxtroops":
        sorted = sorted.sort((a, b) => compare(maxTroops(a), maxTroops(b)));
        break;
      default:
        sorted = sorted.sort((a, b) =>
          compare(a.numTilesOwned(), b.numTilesOwned()),
        );
    }

    const numTilesWithoutFallout =
      gameView.numLandTiles() - gameView.numTilesWithFallout();

    const alivePlayers = sorted.filter((player) => player.isAlive());
    const playersToShow = showTopFive ? alivePlayers.slice(0, 5) : alivePlayers;

    const entriesData = playersToShow.map((player, index) => {
      const maxTroopsVal = gameView.config().maxTroops(player);
      return {
        name: player.displayName(),
        position: index + 1,
        score: formatPercentage(
          player.numTilesOwned() / numTilesWithoutFallout,
        ),
        gold: renderNumber(player.credits()),
        maxTroops: renderTroops(maxTroopsVal),
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        player: player,
      };
    });

    // Add my player if not in top 5
    if (
      myPlayer !== null &&
      entriesData.find((p) => p.isMyPlayer) === undefined
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p === myPlayer) {
          break;
        }
      }

      if (myPlayer.isAlive()) {
        const myPlayerMaxTroops = gameView.config().maxTroops(myPlayer);
        entriesData.pop();
        entriesData.push({
          name: myPlayer.displayName(),
          position: place,
          score: formatPercentage(
            myPlayer.numTilesOwned() / gameView.numLandTiles(),
          ),
          gold: renderNumber(myPlayer.credits()),
          maxTroops: renderTroops(myPlayerMaxTroops),
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
    }

    setPlayers(entriesData);
  };

  const handleSetSort = (key: "tiles" | "gold" | "maxtroops") => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const handleRowClickPlayer = (player: PlayerView) => {
    eventBus.emit(new GoToPlayerEvent(player));
  };

  if (!visible) {
    return <></>;
  }

  return (
    <div
      className="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh] mt-2"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="grid bg-gray-800/85 w-full text-xs md:text-xs lg:text-sm rounded-lg overflow-hidden"
        style={{
          gridTemplateColumns:
            "minmax(24px, 30px) minmax(60px, 100px) minmax(45px, 70px) minmax(40px, 55px) minmax(55px, 105px)",
        }}
      >
        {/* Header */}
        <div className="contents font-bold bg-gray-700/60">
          <div className="py-1 md:py-2 text-center border-b border-slate-500">
            #
          </div>
          <div className="py-1 md:py-2 text-center border-b border-slate-500 truncate">
            {translateText("leaderboard.player")}
          </div>
          <div
            className="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
            onClick={() => handleSetSort("tiles")}
          >
            {translateText("leaderboard.owned")}
            {sortKey === "tiles" ? (sortOrder === "asc" ? "⬆️" : "⬇️") : ""}
          </div>
          <div
            className="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
            onClick={() => handleSetSort("gold")}
          >
            {translateText("leaderboard.gold")}
            {sortKey === "gold" ? (sortOrder === "asc" ? "⬆️" : "⬇️") : ""}
          </div>
          <div
            className="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
            onClick={() => handleSetSort("maxtroops")}
          >
            {translateText("leaderboard.maxtroops")}
            {sortKey === "maxtroops" ? (sortOrder === "asc" ? "⬆️" : "⬇️") : ""}
          </div>
        </div>

        {/* Player rows */}
        {players.map((player, index) => (
          <div
            key={player.player.id()}
            className={`contents hover:bg-slate-600/60 ${
              player.isOnSameTeam ? "font-bold" : ""
            } cursor-pointer`}
            onClick={() => handleRowClickPlayer(player.player)}
          >
            <div
              className={`py-1 md:py-2 text-center ${
                index < players.length - 1 ? "border-b border-slate-500" : ""
              }`}
            >
              {player.position}
            </div>
            <div
              className={`py-1 md:py-2 text-center ${
                index < players.length - 1 ? "border-b border-slate-500" : ""
              } truncate`}
            >
              {player.name}
            </div>
            <div
              className={`py-1 md:py-2 text-center ${
                index < players.length - 1 ? "border-b border-slate-500" : ""
              }`}
            >
              {player.score}
            </div>
            <div
              className={`py-1 md:py-2 text-center ${
                index < players.length - 1 ? "border-b border-slate-500" : ""
              }`}
            >
              {player.gold}
            </div>
            <div
              className={`py-1 md:py-2 text-center ${
                index < players.length - 1 ? "border-b border-slate-500" : ""
              }`}
            >
              {player.maxTroops}
            </div>
          </div>
        ))}
      </div>

      <button
        className="mt-2 p-0.5 px-1.5 md:px-2 text-xs md:text-xs lg:text-sm
        border rounded-md border-slate-500 transition-colors
        text-white mx-auto block hover:bg-white/10 bg-gray-700/50"
        onClick={() => setShowTopFive(!showTopFive)}
      >
        {showTopFive ? "+" : "-"}
      </button>
    </div>
  );
}

export { Leaderboard };
export default Leaderboard;
