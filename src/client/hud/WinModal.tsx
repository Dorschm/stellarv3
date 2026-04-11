import React, { useCallback, useEffect, useState } from "react";
import { ColorPalette, Pattern } from "../../core/CosmeticSchemas";
import { RankedType, RunScore } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { getUserMe } from "../Api";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "../Cosmetics";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { Platform } from "../Platform";
import { saveRunScore } from "../RunHistory";
import { SendWinnerEvent } from "../Transport";
import {
  getGamesPlayed,
  isInIframe,
  translateText,
  TUTORIAL_VIDEO_URL,
} from "../Utils";
import { useGameTick } from "./useGameTick";

interface PatternContent {
  pattern: Pattern;
  colorPalette: ColorPalette;
}

export function WinModal(): React.JSX.Element {
  const { gameView, eventBus } = useGameTick(100);

  const [isVisible, setIsVisible] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [isWin, setIsWin] = useState(false);
  const [isRankedGame, setIsRankedGame] = useState(false);
  const [title, setTitle] = useState("");
  const [patternContent, setPatternContent] = useState<PatternContent[] | null>(
    null,
  );
  const [hasShownDeathModal, setHasShownDeathModal] = useState(false);
  const [rand] = useState(Math.random());
  const [runScore, setRunScore] = useState<RunScore | null>(null);

  const loadPatternContent = useCallback(async () => {
    try {
      const me = await getUserMe();
      const patterns = await fetchCosmetics();

      const purchasablePatterns: PatternContent[] = [];

      for (const pattern of Object.values(patterns?.patterns ?? {})) {
        for (const colorPalette of pattern.colorPalettes ?? []) {
          if (
            patternRelationship(pattern, colorPalette, me, null) ===
            "purchasable"
          ) {
            const palette = patterns?.colorPalettes?.[colorPalette.name];
            if (palette) {
              purchasablePatterns.push({
                pattern,
                colorPalette: palette,
              });
            }
          }
        }
      }

      if (purchasablePatterns.length === 0) {
        setPatternContent([]);
        return;
      }

      // Shuffle the array and take patterns based on screen size
      const shuffled = [...purchasablePatterns].sort(() => Math.random() - 0.5);
      const maxPatterns = Platform.isMobileWidth ? 1 : 3;
      const selectedPatterns = shuffled.slice(
        0,
        Math.min(maxPatterns, shuffled.length),
      );

      setPatternContent(selectedPatterns);
    } catch (error) {
      console.error("Error loading pattern content:", error);
      setPatternContent([]);
    }
  }, []);

  const show = useCallback(async () => {
    crazyGamesSDK.gameplayStop();
    await loadPatternContent();
    setIsRankedGame(
      gameView.config().gameConfig().rankedType === RankedType.OneVOne,
    );
    setIsVisible(true);
    setTimeout(() => {
      setShowButtons(true);
    }, 3000);
  }, [gameView, loadPatternContent]);

  const hide = useCallback(() => {
    setIsVisible(false);
    setShowButtons(false);
  }, []);

  const handleExit = useCallback(() => {
    hide();
    window.location.href = "/";
  }, [hide]);

  const handleRequeue = useCallback(() => {
    hide();
    window.location.href = "/?requeue";
  }, [hide]);

  // Monitor game state for win/death conditions
  useEffect(() => {
    const myPlayer = gameView.myPlayer();
    if (
      !hasShownDeathModal &&
      myPlayer &&
      !myPlayer.isAlive() &&
      !gameView.inSpawnPhase() &&
      myPlayer.hasSpawned()
    ) {
      setHasShownDeathModal(true);
      setTitle(translateText("win_modal.died"));
      show();
    }

    const updates = gameView.updatesSinceLastTick();
    const winUpdates = updates !== null ? updates[GameUpdateType.Win] : [];
    winUpdates.forEach((wu) => {
      if (wu.runScore) {
        setRunScore(wu.runScore);
        // GDD §10 — persist run score to localStorage. Note: when
        // `wu.winner[0] === "nation"` no human can be the winner, so
        // `isWinner` deliberately remains `false` and the run is recorded
        // as a "loss" for every connected human client. This is
        // intentional, not a bug — nation wins are not human wins, and
        // counting them as such would inflate `aiDifficultyForWinCount()`
        // in `RunHistory` past the player's actual skill level.
        const mapName = gameView.config().gameConfig().gameMap ?? "Unknown";
        const isWinner =
          wu.winner !== undefined &&
          ((wu.winner[0] === "player" &&
            wu.winner[1] === gameView.myPlayer()?.clientID()) ||
            (wu.winner[0] === "team" &&
              wu.winner[1] === gameView.myPlayer()?.team()));
        saveRunScore(wu.runScore, mapName, null, isWinner ? "win" : "loss");
      }
      if (wu.winner === undefined) {
        // ...
      } else if (wu.winner[0] === "team") {
        eventBus.emit(new SendWinnerEvent(wu.winner, wu.allPlayersStats));
        if (wu.winner[1] === gameView.myPlayer()?.team()) {
          setTitle(translateText("win_modal.your_team"));
          setIsWin(true);
          crazyGamesSDK.happytime();
        } else {
          setTitle(
            translateText("win_modal.other_team", {
              team: wu.winner[1],
            }),
          );
          setIsWin(false);
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        show();
      } else if (wu.winner[0] === "nation") {
        setTitle(
          translateText("win_modal.nation_won", {
            nation: wu.winner[1],
          }),
        );
        setIsWin(false);
        show();
      } else {
        const winner = gameView.playerByClientID(wu.winner[1]);
        if (!winner?.isPlayer()) return;
        const winnerClient = winner.clientID();
        if (winnerClient !== null) {
          eventBus.emit(
            new SendWinnerEvent(["player", winnerClient], wu.allPlayersStats),
          );
        }
        if (
          winnerClient !== null &&
          winnerClient === gameView.myPlayer()?.clientID()
        ) {
          setTitle(translateText("win_modal.you_won"));
          setIsWin(true);
          crazyGamesSDK.happytime();
        } else {
          setTitle(
            translateText("win_modal.other_won", {
              player: winner.displayName(),
            }),
          );
          setIsWin(false);
        }
        history.replaceState(null, "", `${window.location.pathname}?replay`);
        show();
      }
    });
  }, [gameView, eventBus, hasShownDeathModal, show]);

  const renderInnerContent = () => {
    if (isInIframe()) {
      return renderSteamWishlist();
    }

    if (!isWin && getGamesPlayed() < 3) {
      return renderYoutubeTutorial();
    }
    if (rand < 0.25) {
      return renderSteamWishlist();
    } else if (rand < 0.5) {
      return renderDiscordDisplay();
    } else {
      return renderPatternButton();
    }
  };

  /**
   * GDD §10 — Scoring panel: planets conquered, systems controlled,
   * survival time, final ranking. Rendered above the rest of the modal
   * body whenever the win event carried a {@link RunScore} payload.
   * Survival is shown in seconds (10 ticks/sec on the standard tick rate)
   * to match the existing in-game timer formatting.
   */
  const renderRunScore = () => {
    if (!runScore || runScore.players.length === 0) return null;
    const myClientID = gameView.myPlayer()?.clientID();
    return (
      <div className="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
        <h3 className="text-xl font-semibold text-white mb-3">
          {translateText("win_modal.run_score") || "Run Score"}
        </h3>
        <table className="w-full text-sm text-white">
          <thead>
            <tr className="text-left border-b border-white/30">
              <th className="py-1 pr-2">
                {translateText("win_modal.run_score_rank")}
              </th>
              <th className="py-1 pr-2">
                {translateText("win_modal.run_score_player")}
              </th>
              <th className="py-1 pr-2 text-right">
                {translateText("win_modal.run_score_planets")}
              </th>
              <th className="py-1 pr-2 text-right">
                {translateText("win_modal.run_score_systems")}
              </th>
              <th className="py-1 text-right">
                {translateText("win_modal.run_score_survived")}
              </th>
            </tr>
          </thead>
          <tbody>
            {runScore.players.map((p) => {
              const isMe = p.clientID !== null && p.clientID === myClientID;
              return (
                <tr
                  key={`${p.playerID}-${p.eliminationRank}`}
                  className={isMe ? "bg-white/10" : ""}
                >
                  <td className="py-1 pr-2">{p.eliminationRank}</td>
                  <td className="py-1 pr-2">{p.name}</td>
                  <td className="py-1 pr-2 text-right">{p.planetsConquered}</td>
                  <td className="py-1 pr-2 text-right">
                    {p.systemsControlled}
                  </td>
                  <td className="py-1 text-right">
                    {Math.round(p.survivalTicks / 10)}s
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderYoutubeTutorial = () => (
    <div className="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
      <h3 className="text-xl font-semibold text-white mb-3">
        {translateText("win_modal.youtube_tutorial")}
      </h3>
      <div className="relative w-full pb-[56.25%]">
        <iframe
          className="absolute top-0 left-0 w-full h-full rounded-sm"
          src={isVisible ? TUTORIAL_VIDEO_URL : ""}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        ></iframe>
      </div>
    </div>
  );

  const renderPatternButton = () => (
    <div className="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
      <h3 className="text-xl font-semibold text-white mb-3">
        {translateText("win_modal.support_stellar_game")}
      </h3>
      <p className="text-white mb-3">
        {translateText("win_modal.territory_pattern")}
      </p>
      <div className="flex justify-center flex-wrap gap-4">
        {patternContent && patternContent.length > 0
          ? patternContent.map(({ pattern, colorPalette }) => (
              <pattern-button
                key={`${pattern.name}-${colorPalette.name}`}
                pattern={pattern}
                colorPalette={colorPalette}
                requiresPurchase={true}
                onSelect={() => {}}
                onPurchase={(p: Pattern, cp: ColorPalette | null) =>
                  handlePurchase(p.product!, cp?.name)
                }
              ></pattern-button>
            ))
          : null}
      </div>
    </div>
  );

  const renderSteamWishlist = () => (
    <p className="m-0 mb-5 text-center bg-black/30 p-2.5 rounded-sm">
      <a
        href="https://store.steampowered.com/app/3560670"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4a9eff] underline font-medium transition-colors duration-200 text-2xl hover:text-[#6db3ff] no-underline"
      >
        {translateText("win_modal.wishlist")}
      </a>
    </p>
  );

  const renderDiscordDisplay = () => (
    <div className="text-center mb-6 bg-black/30 p-2.5 rounded-sm">
      <h3 className="text-xl font-semibold text-white mb-3">
        {translateText("win_modal.join_discord")}
      </h3>
      <p className="text-white mb-3">
        {translateText("win_modal.discord_description")}
      </p>
      <a
        href="https://discord.com/invite/openfront"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-sm font-semibold transition-all duration-200 hover:bg-indigo-700 hover:-translate-y-px no-underline"
      >
        {translateText("win_modal.join_server")}
      </a>
    </div>
  );

  return (
    <div
      className={
        isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 shrink-0 rounded-lg z-9999 shadow-2xl backdrop-blur-xs text-white w-87.5 max-w-[90%] md:w-175"
          : "hidden"
      }
    >
      <h2 className="m-0 mb-4 text-[26px] text-center text-white">{title}</h2>
      {renderRunScore()}
      {renderInnerContent()}
      <div className={showButtons ? "flex justify-between gap-2.5" : "hidden"}>
        <button
          onClick={handleExit}
          className="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
        >
          {translateText("win_modal.exit")}
        </button>
        {isRankedGame ? (
          <button
            onClick={handleRequeue}
            className="flex-1 px-3 py-3 text-base cursor-pointer bg-purple-600 text-white border-0 rounded-sm transition-all duration-200 hover:bg-purple-500 hover:-translate-y-px active:translate-y-px"
          >
            {translateText("win_modal.requeue")}
          </button>
        ) : null}
        <button
          onClick={hide}
          className="flex-1 px-3 py-3 text-base cursor-pointer bg-blue-500/60 text-white border-0 rounded-sm transition-all duration-200 hover:bg-blue-500/80 hover:-translate-y-px active:translate-y-px"
        >
          {gameView?.myPlayer()?.isAlive()
            ? translateText("win_modal.keep")
            : translateText("win_modal.spectate")}
        </button>
      </div>
    </div>
  );
}

export default WinModal;
