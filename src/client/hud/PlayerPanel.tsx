import React, { useState, useCallback, useEffect } from "react";
import Countries from "resources/countries.json" with { type: "json" };
import { assetUrl } from "../../core/AssetUrls";
import {
  AllPlayers,
  PlayerActions,
  PlayerProfile,
  PlayerType,
  Relation,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { Emoji, flattenedEmojiTable } from "../../core/Util";
import {
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
  SendEmbargoAllIntentEvent,
  SendEmbargoIntentEvent,
  SendEmojiIntentEvent,
  SendTargetPlayerIntentEvent,
} from "../Transport";
import {
  CloseViewEvent,
  MouseUpEvent,
  SwapRocketDirectionEvent,
} from "../InputHandler";
import {
  renderDuration,
  renderNumber,
  renderTroops,
  translateText,
} from "../Utils";
import { useGameTick } from "./useGameTick";
import { useEventBus } from "../bridge/useEventBus";
import { useHUDStore } from "../bridge/HUDStore";
import { ShowPlayerPanelEvent } from "./events";

const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
const stopTradingIcon = assetUrl("images/StopIconWhite.png");
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const startTradingIcon = assetUrl("images/TradingIconWhite.png");
const traitorIcon = assetUrl("images/TraitorIconLightRed.svg");
const breakAllianceIcon = assetUrl("images/TraitorIconWhite.svg");

export function PlayerPanel(): React.JSX.Element {
  const { gameView, eventBus } = useGameTick(100);

  const [isVisible, setIsVisible] = useState(false);
  const [tile, setTile] = useState<TileRef | null>(null);
  const [actions, setActions] = useState<PlayerActions | null>(null);
  const [otherProfile, setOtherProfile] = useState<PlayerProfile | null>(null);
  const [allianceExpiryText, setAllianceExpiryText] = useState<string | null>(null);
  const [allianceExpirySeconds, setAllianceExpirySeconds] = useState<number | null>(null);
  const [suppressNextHide, setSuppressNextHide] = useState(false);
  const [moderationTarget, setModerationTarget] = useState(null);
  const [profileForPlayerId, setProfileForPlayerId] = useState<number | null>(null);
  const [kickedPlayerIDs] = useState(new Set<string>());

  const hidePanel = useCallback(() => {
    setIsVisible(false);
    setModeration(null);
  }, []);

  const showPanel = useCallback(
    (panelActions: PlayerActions, panelTile: TileRef) => {
      setActions(panelActions);
      setTile(panelTile);
      setModerationTarget(null);
      setIsVisible(true);
    },
    [],
  );

  const setModeration = (target: any) => {
    setModerationTarget(target);
  };

  // Listen for close events
  useEventBus(eventBus, CloseViewEvent, () => {
    if (isVisible) {
      hidePanel();
    }
  });

  useEventBus(eventBus, MouseUpEvent, () => {
    if (suppressNextHide) {
      setSuppressNextHide(false);
      return;
    }
    hidePanel();
  });

  useEventBus(eventBus, SwapRocketDirectionEvent, (event) => {
    useHUDStore.getState().setRocketDirectionUp(event.rocketDirectionUp);
    setIsVisible((prev) => !prev); // Force re-render
  });

  useEventBus(eventBus, ShowPlayerPanelEvent, (event) => {
    showPanel(event.actions, event.tile);
  });

  // Refresh profile and actions on tick
  useEffect(() => {
    if (!isVisible || !tile) return;

    const owner = gameView.owner(tile);
    if (owner && owner.isPlayer()) {
      const playerId = Number(owner.id());
      if (profileForPlayerId !== playerId) {
        owner.profile().then((profile) => {
          setOtherProfile(profile);
          setProfileForPlayerId(playerId);
        });
      }
    }

    // Refresh actions & alliance expiry
    const myPlayer = gameView.myPlayer();
    if (myPlayer !== null && myPlayer.isAlive()) {
      myPlayer.actions(tile, null).then((panelActions) => {
        setActions(panelActions);

        if (panelActions?.interaction?.allianceInfo?.expiresAt !== undefined) {
          const expiresAt = panelActions.interaction.allianceInfo.expiresAt;
          const remainingTicks = expiresAt - gameView.ticks();
          const remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10));

          if (remainingTicks > 0) {
            setAllianceExpirySeconds(remainingSeconds);
            setAllianceExpiryText(renderDuration(remainingSeconds));
          } else {
            setAllianceExpirySeconds(null);
            setAllianceExpiryText(null);
          }
        } else {
          setAllianceExpirySeconds(null);
          setAllianceExpiryText(null);
        }
      });
    }
  }, [gameView, isVisible, tile, profileForPlayerId]);

  const handleAllianceClick = useCallback(
    (other: any) => {
      const myPlayer = gameView.myPlayer();
      if (myPlayer) {
        eventBus.emit(new SendAllianceRequestIntentEvent(myPlayer, other));
        hidePanel();
      }
    },
    [gameView, eventBus, hidePanel],
  );

  const handleBreakAllianceClick = useCallback(
    (other: any) => {
      const myPlayer = gameView.myPlayer();
      if (myPlayer) {
        eventBus.emit(new SendBreakAllianceIntentEvent(myPlayer, other));
        hidePanel();
      }
    },
    [gameView, eventBus, hidePanel],
  );

  const handleEmbargoClick = useCallback(
    (other: any) => {
      eventBus.emit(new SendEmbargoIntentEvent(other, "start"));
      hidePanel();
    },
    [eventBus, hidePanel],
  );

  const handleStopEmbargoClick = useCallback(
    (other: any) => {
      eventBus.emit(new SendEmbargoIntentEvent(other, "stop"));
      hidePanel();
    },
    [eventBus, hidePanel],
  );

  const handleStopTradingAllClick = useCallback(() => {
    eventBus.emit(new SendEmbargoAllIntentEvent("start"));
  }, [eventBus]);

  const handleStartTradingAllClick = useCallback(() => {
    eventBus.emit(new SendEmbargoAllIntentEvent("stop"));
  }, [eventBus]);

  const handleTargetClick = useCallback(
    (other: any) => {
      eventBus.emit(new SendTargetPlayerIntentEvent(other.id()));
      hidePanel();
    },
    [eventBus, hidePanel],
  );

  const identityChipProps = (type: PlayerType) => {
    switch (type) {
      case PlayerType.Nation:
        return {
          labelKey: "player_type.nation",
          classes: "border-indigo-400/25 bg-indigo-500/10 text-indigo-200",
          icon: "🏛️",
        };
      case PlayerType.Bot:
        return {
          labelKey: "player_type.bot",
          classes: "border-purple-400/25 bg-purple-500/10 text-purple-200",
          icon: "⚔️",
        };
      case PlayerType.Human:
      default:
        return {
          labelKey: "player_type.player",
          classes: "border-zinc-400/20 bg-zinc-500/5 text-zinc-300",
          icon: "👤",
        };
    }
  };

  const getRelationClass = (relation: Relation): string => {
    const base =
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 " +
      "shadow-[inset_0_0_8px_rgba(255,255,255,0.04)]";

    switch (relation) {
      case Relation.Hostile:
        return `${base} border-red-400/30 bg-red-500/10 text-red-200`;
      case Relation.Distrustful:
        return `${base} border-red-300/40 bg-red-300/10 text-red-300`;
      case Relation.Friendly:
        return `${base} border-emerald-400/30 bg-emerald-500/10 text-emerald-200`;
      case Relation.Neutral:
      default:
        return `${base} border-zinc-400/30 bg-zinc-500/10 text-zinc-200`;
    }
  };

  const getRelationName = (relation: Relation): string => {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Friendly:
        return translateText("relation.friendly");
      case Relation.Neutral:
      default:
        return translateText("relation.neutral");
    }
  };

  if (!isVisible || !tile) {
    return null as any;
  }

  const myPlayer = gameView.myPlayer();
  if (!myPlayer) return null as any;

  const owner = gameView.owner(tile);
  if (!owner || !owner.isPlayer()) {
    hidePanel();
    return null as any;
  }

  const other = owner as any;
  const flagCode = other.cosmetics.flag;
  const country =
    typeof flagCode === "string"
      ? Countries.find((c) => c.code === flagCode)
      : undefined;

  const chip =
    other.type() === PlayerType.Human
      ? null
      : identityChipProps(other.type());

  const shouldShowRelationPill =
    other.type() === PlayerType.Nation &&
    !other.isTraitor() &&
    !(myPlayer?.isAlliedWith && myPlayer.isAlliedWith(other)) &&
    otherProfile;

  const relationValue = shouldShowRelationPill
    ? otherProfile?.relations?.[myPlayer.smallID()] ?? Relation.Neutral
    : null;

  return (
    <div
      className="fixed inset-0 z-10001 flex items-center justify-center overflow-auto bg-black/15 backdrop-brightness-110 pointer-events-auto"
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => e.stopPropagation()}
      onClick={() => hidePanel()}
    >
      <div
        className="pointer-events-auto max-h-[90vh] min-w-75 max-w-100 px-4 py-2 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`relative bg-zinc-900/95 rounded-xl shadow-2xl shadow-black/50 border border-white/5 p-4 ring-1 ring-white/10 ${
            other.isTraitor() ? "traitor-ring" : ""
          }`}
          style={{
            maxWidth: "28rem",
          }}
        >
          <button
            onClick={hidePanel}
            className="absolute top-2 right-2 text-zinc-400 hover:text-white transition-colors"
          >
            ✕
          </button>

          <div className="flex items-center gap-2.5 flex-wrap mb-3">
            {country && typeof flagCode === "string" && (
              <img
                src={assetUrl(
                  `flags/${encodeURIComponent(flagCode)}.svg`,
                )}
                alt={country?.name ?? "Flag"}
                className="h-10 w-10 rounded-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}

            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold tracking-[-0.01em] text-zinc-50 truncate">
                {other.displayName()}
              </h2>
            </div>

            {chip && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${chip.classes}`}
                title={translateText(chip.labelKey)}
              >
                <span className="leading-none">{chip.icon}</span>
                <span className="tracking-tight">
                  {translateText(chip.labelKey)}
                </span>
              </span>
            )}
          </div>

          {other.isTraitor() && (
            <div className="mt-1 mb-3">
              <span
                className="inline-flex items-center gap-2 rounded-full border border-red-400/30
                  bg-red-500/10 px-2.5 py-0.5 text-sm font-semibold text-red-200
                  shadow-[inset_0_0_8px_rgba(239,68,68,0.12)]"
                title={translateText("player_panel.traitor")}
              >
                <img
                  src={traitorIcon}
                  alt=""
                  className="w-4 h-4"
                />
                <span className="tracking-tight">
                  {translateText("player_panel.traitor")}
                </span>
              </span>
            </div>
          )}

          {shouldShowRelationPill && relationValue !== null && (
            <div className="mt-1 mb-3">
              <span className={`text-sm font-semibold ${getRelationClass(relationValue)}`}>
                {getRelationName(relationValue)}
              </span>
            </div>
          )}

          <div className="mb-3 flex justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 shrink-0 text-white">
              <span>💰</span>
              <span className="tabular-nums font-semibold">
                {renderNumber(other.gold() || 0)}
              </span>
              <span className="text-zinc-200 whitespace-nowrap">
                {translateText("player_panel.gold")}
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 shrink-0 text-white">
              <span>⚔️</span>
              <span className="tabular-nums font-semibold">
                {renderTroops(Number(other.troops() || 0n))}
              </span>
              <span className="text-zinc-200 whitespace-nowrap">
                {translateText("player_panel.troops")}
              </span>
            </div>
          </div>

          {allianceExpiryText && (
            <div className="mb-3 text-sm text-white">
              Alliance expires: <span className="font-semibold">{allianceExpiryText}</span>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {actions?.interaction?.canSendAllianceRequest && (
              <button
                onClick={() => handleAllianceClick(other)}
                className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                title={translateText("player_panel.send_alliance")}
              >
                <img src={allianceIcon} alt="" className="w-4 h-4" />
                {translateText("player_panel.send_alliance")}
              </button>
            )}

            {actions?.interaction?.canBreakAlliance && (
              <button
                onClick={() => handleBreakAllianceClick(other)}
                className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                title={translateText("player_panel.break_alliance")}
              >
                <img src={breakAllianceIcon} alt="" className="w-4 h-4" />
                {translateText("player_panel.break_alliance")}
              </button>
            )}

            {actions?.interaction?.canTarget && (
              <button
                onClick={() => handleTargetClick(other)}
                className="flex items-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors"
                title={translateText("player_panel.target")}
              >
                <img src={targetIcon} alt="" className="w-4 h-4" />
                {translateText("player_panel.target")}
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .traitor-ring {
          border-radius: 1rem;
          box-shadow:
            0 0 0 2px rgba(239, 68, 68, 0.34),
            0 0 12px 4px rgba(239, 68, 68, 0.22),
            inset 0 0 14px rgba(239, 68, 68, 0.13);
          animation: glowPulse 2.4s ease-in-out infinite;
        }
        @keyframes glowPulse {
          0%,
          100% {
            box-shadow:
              0 0 0 2px rgba(239, 68, 68, 0.22),
              0 0 8px 2px rgba(239, 68, 68, 0.15),
              inset 0 0 8px rgba(239, 68, 68, 0.07);
          }
          50% {
            box-shadow:
              0 0 0 4px rgba(239, 68, 68, 0.38),
              0 0 18px 6px rgba(239, 68, 68, 0.26),
              inset 0 0 18px rgba(239, 68, 68, 0.15);
          }
        }
      `}</style>
    </div>
  );
}

export default PlayerPanel;
