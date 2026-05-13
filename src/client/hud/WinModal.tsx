import React, { useCallback, useEffect, useState } from "react";
import { ColorPalette, Pattern } from "../../core/CosmeticSchemas";
import { RankedType, RunScore } from "../../core/game/Game";
import { GameUpdateType, WinUpdate } from "../../core/game/GameUpdates";
import { getUserMe } from "../Api";
import {
  fetchCosmetics,
  handlePurchase,
  patternRelationship,
} from "../Cosmetics";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { SceneTickEvent } from "../InputHandler";
import { Platform } from "../Platform";
import { saveRunScore } from "../RunHistory";
import { pushRunScore } from "../RunHistoryApi";
import { SendWinnerEvent } from "../Transport";
import { isInIframe, translateText } from "../Utils";
import { useGameTick } from "./useGameTick";

interface PatternContent {
  pattern: Pattern;
  colorPalette: ColorPalette;
}

export function WinModal(): React.JSX.Element {
  // Death detection re-runs on every tick (no throttle). Cost is
  // negligible while the modal is hidden — render returns early. The
  // win path is handled separately via a SceneTickEvent listener
  // (see effect below) because polling updatesSinceLastTick() under
  // throttled re-renders silently drops Win updates during catch-up
  // ticks (the lastUpdate buffer is overwritten before React renders).
  const { gameView, eventBus, tick } = useGameTick(0);

  const [isVisible, setIsVisible] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  // `isWin` itself is no longer read after the social-promo blocks
  // (Discord invite + YouTube tutorial) were stripped from the modal, but
  // the setter is still called from the win/loss detection effects below
  // for future-proofing. Silence the unused-state-value lint by reading
  // the value into a discard.
  const [isWin, setIsWin] = useState(false);
  void isWin;
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

  // Death detection: re-runs every tick via the `tick` dep. Once the
  // local player has spawned and is no longer alive, fire the modal.
  // `isAlive()` latches false after death, so a single observation is
  // enough — no race with tick batching.
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
  }, [gameView, hasShownDeathModal, show, tick]);

  // Win detection: subscribe to SceneTickEvent so every tick's updates
  // are observed exactly once, even during reconnects or catch-up where
  // multiple ticks land between React renders. Polling
  // updatesSinceLastTick() from a throttled re-render dropped these
  // Win events, leaving the end-game modal silently absent for some
  // players.
  const handleWinUpdate = useCallback(
    (wu: WinUpdate) => {
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
        const saved = saveRunScore(
          wu.runScore,
          mapName,
          null,
          isWinner ? "win" : "loss",
        );
        if (saved !== null) {
          void pushRunScore(saved);
        }
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
    },
    [gameView, eventBus, show],
  );

  useEffect(() => {
    const handler = (event: SceneTickEvent) => {
      const winUpdates = event.updates[GameUpdateType.Win];
      if (winUpdates && winUpdates.length > 0) {
        winUpdates.forEach(handleWinUpdate);
      }
    };
    eventBus.on(SceneTickEvent, handler);
    return () => {
      eventBus.off(SceneTickEvent, handler);
    };
  }, [eventBus, handleWinUpdate]);

  const renderInnerContent = () => {
    // Branding/social-promo blocks (Discord invite, YouTube tutorial) were
    // removed — only the pattern-button cosmetic prompt remains. `rand`
    // and `isInIframe` previously selected between those branches.
    void rand;
    void isInIframe;
    return renderPatternButton();
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

  if (!isVisible) return <div className="hidden" />;
  return (
    <>
      <div
        className="fixed inset-0 z-[9998] pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 shrink-0 rounded-lg z-[9999] shadow-2xl backdrop-blur-xs text-white w-87.5 max-w-[90%] md:w-175 pointer-events-auto">
        <h2 className="m-0 mb-4 text-[26px] text-center text-white">{title}</h2>
        {renderRunScore()}
        {renderInnerContent()}
        <div
          className={showButtons ? "flex justify-between gap-2.5" : "hidden"}
        >
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
    </>
  );
}

export default WinModal;
