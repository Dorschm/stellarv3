import React, { useCallback, useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { PlayerActions, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { PlayerView } from "../../core/game/GameView";
import { translateText } from "../Utils";
import { useGameView } from "../bridge/GameViewContext";
import { useHUDStore } from "../bridge/HUDStore";
import { useEventBus } from "../bridge/useEventBus";
import {
  CloseViewEvent,
  ContextMenuEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../InputHandler";
import {
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
} from "../Transport";
import {
  CloseRadialMenuEvent,
  ShowPlayerPanelEvent,
} from "./events";

const attackIcon = assetUrl("images/SwordIconWhite.svg");
const boatIcon = assetUrl("images/BoatIconWhite.svg");
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");

/**
 * Radial-style context menu for the migrated R3F HUD.
 *
 * The legacy canvas-based MainRadialMenu + RadialMenuElements layers were
 * removed in T7 along with the rest of the Lit graphics layers. This
 * component restores the core context-menu interaction surface in the new
 * React/R3F pipeline:
 *
 *   • Listens for `ContextMenuEvent` from `SpaceMapPlane` (tile coordinates).
 *   • Fetches `PlayerActions` for the clicked tile against `myPlayer`.
 *   • Offers context-sensitive options: Build menu, Emoji, Player panel,
 *     Ground attack, Boat attack. These are the same entry points previously
 *     reachable via the legacy radial menu.
 *   • On selection, it emits the same events the legacy flow produced:
 *       - Build    → `ShowBuildMenuEvent(tileX, tileY)`
 *       - Emoji    → `ShowEmojiMenuEvent(tileX, tileY)`
 *       - Player   → `ShowPlayerPanelEvent(actions, tile)`
 *       - Attack   → `SendAttackIntentEvent(targetID, troops)`
 *       - Boat     → `SendBoatAttackIntentEvent(tile, troops)`
 *
 * The menu closes automatically when the player clicks the map again,
 * presses Escape, or picks any action.
 */
export function RadialMenu(): React.JSX.Element | null {
  const { gameView, eventBus } = useGameView();

  const [isVisible, setIsVisible] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [tile, setTile] = useState<TileRef | null>(null);
  const [actions, setActions] = useState<PlayerActions | null>(null);

  const hide = useCallback(() => {
    setIsVisible(false);
    setAnchor(null);
    setTile(null);
    setActions(null);
  }, []);

  // -- Listen for context-menu clicks from SpaceMapPlane ---------------------
  const onContextMenu = useCallback(
    (e: ContextMenuEvent) => {
      // SpaceMapPlane always emits tile coordinates (isTileCoord = true).
      // Guard anyway in case a legacy emitter reaches us.
      if (!e.isTileCoord) return;
      if (!gameView.isValidCoord(e.x, e.y)) return;
      const myPlayer = gameView.myPlayer();
      if (myPlayer === null) return;

      const clickedTile = gameView.ref(e.x, e.y);
      // Prefer the screen-space coordinates carried on the event when the
      // emitter had a native pointer event; fall back to the viewport centre
      // when they're absent (e.g. legacy emitters without a DOM event).
      const anchorX =
        typeof e.screenX === "number" ? e.screenX : window.innerWidth / 2;
      const anchorY =
        typeof e.screenY === "number" ? e.screenY : window.innerHeight / 2;
      setAnchor({ x: anchorX, y: anchorY });
      setTile(clickedTile);
      setActions(null);
      setIsVisible(true);

      myPlayer.actions(clickedTile, null).then((resolved) => {
        setActions(resolved);
      });
    },
    [gameView],
  );
  useEventBus(eventBus, ContextMenuEvent, onContextMenu);

  // -- Auto-close handlers ---------------------------------------------------
  // These are wrapped in useCallback so their identity is stable across
  // renders — otherwise useEventBus would tear down and re-subscribe on
  // every render. `hide()` is itself a stable useCallback and is safe to
  // call when the menu is already hidden (React bails out on unchanged
  // state), so the callbacks do not need to close over `isVisible`.
  const onAutoClose = useCallback(() => {
    hide();
  }, [hide]);
  useEventBus(eventBus, CloseViewEvent, onAutoClose);
  useEventBus(eventBus, CloseRadialMenuEvent, onAutoClose);
  useEventBus(eventBus, MouseDownEvent, onAutoClose);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isVisible, hide]);

  if (!isVisible || tile === null || anchor === null) return null;

  // Compute tile X/Y for events that carry raw coordinates.
  const tileX = gameView.x(tile);
  const tileY = gameView.y(tile);
  const tileOwner = gameView.owner(tile);
  const ownerIsPlayer = tileOwner.isPlayer();
  const ownerPlayer = ownerIsPlayer ? (tileOwner as PlayerView) : null;
  const myPlayer = gameView.myPlayer();

  // -- Action handlers -------------------------------------------------------
  const handleBuild = () => {
    eventBus.emit(new ShowBuildMenuEvent(tileX, tileY));
    hide();
  };

  const handleEmoji = () => {
    if (!ownerIsPlayer) return;
    eventBus.emit(new ShowEmojiMenuEvent(tileX, tileY));
    hide();
  };

  const handlePlayerPanel = () => {
    if (!actions || !ownerIsPlayer) return;
    eventBus.emit(new ShowPlayerPanelEvent(actions, tile));
    hide();
  };

  const handleAttack = () => {
    if (!myPlayer || !actions?.canAttack) return;
    // GameBridge.attackRatio (0..1) is canonical, but we don't have the
    // bridge instance here. Read directly from the HUDStore and normalize.
    const percent = useHUDStore.getState().attackRatio;
    const ratio = Math.max(0, Math.min(100, percent)) / 100;
    eventBus.emit(
      new SendAttackIntentEvent(
        ownerPlayer ? ownerPlayer.id() : null,
        myPlayer.troops() * ratio,
      ),
    );
    hide();
  };

  const handleBoat = () => {
    if (!myPlayer) return;
    const canBoat = actions?.buildableUnits.some(
      (bu) => bu.type === UnitType.TransportShip && bu.canBuild !== false,
    );
    if (!canBoat) return;
    const percent = useHUDStore.getState().attackRatio;
    const ratio = Math.max(0, Math.min(100, percent)) / 100;
    eventBus.emit(
      new SendBoatAttackIntentEvent(tile, myPlayer.troops() * ratio),
    );
    hide();
  };

  const canAttack = !!actions?.canAttack;
  const canBoat =
    actions?.buildableUnits.some(
      (bu) => bu.type === UnitType.TransportShip && bu.canBuild !== false,
    ) ?? false;
  const canEmoji = ownerIsPlayer;
  const canOpenPlayerPanel = ownerIsPlayer && actions !== null;
  const canBuild = !gameView.inSpawnPhase();

  // -- Render ----------------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-[9500] pointer-events-auto"
      onClick={hide}
      onContextMenu={(e) => {
        e.preventDefault();
        hide();
      }}
      style={{
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        className="absolute flex flex-col gap-2 p-3 rounded-xl bg-zinc-900/95 ring-1 ring-white/10 shadow-2xl shadow-black/50 min-w-48"
        style={{
          left: anchor.x,
          top: anchor.y,
          transform: "translate(-50%, -50%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider pb-1 border-b border-white/10">
          {ownerPlayer
            ? ownerPlayer.displayName()
            : translateText("radial_menu.unowned") || "Unowned territory"}
        </div>

        <RadialButton
          icon={buildIcon}
          label={translateText("build_menu.title") || "Build"}
          disabled={!canBuild}
          onClick={handleBuild}
        />

        <RadialButton
          icon={attackIcon}
          label={translateText("radial_menu.attack") || "Attack"}
          disabled={!canAttack}
          onClick={handleAttack}
          color="bg-red-700/80 hover:bg-red-600/80"
        />

        <RadialButton
          icon={boatIcon}
          label={translateText("radial_menu.boat") || "Boat attack"}
          disabled={!canBoat}
          onClick={handleBoat}
          color="bg-sky-700/80 hover:bg-sky-600/80"
        />

        <RadialButton
          icon={emojiIcon}
          label={translateText("player_panel.emotes") || "Emoji"}
          disabled={!canEmoji}
          onClick={handleEmoji}
        />

        <RadialButton
          icon={infoIcon}
          label={translateText("radial_menu.player_info") || "Player info"}
          disabled={!canOpenPlayerPanel}
          onClick={handlePlayerPanel}
        />
      </div>
    </div>
  );
}

interface RadialButtonProps {
  icon: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
  color?: string;
}

function RadialButton({
  icon,
  label,
  disabled,
  onClick,
  color,
}: RadialButtonProps): React.JSX.Element {
  const base =
    "flex items-center gap-2 px-3 py-2 rounded text-white text-sm transition-colors";
  const enabledColor = color ?? "bg-zinc-800 hover:bg-zinc-700";
  const cls = disabled
    ? `${base} bg-zinc-800/50 text-zinc-500 cursor-not-allowed`
    : `${base} ${enabledColor} cursor-pointer`;
  return (
    <button
      className={cls}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <img src={icon} alt="" className="w-5 h-5" />
      <span>{label}</span>
    </button>
  );
}

export default RadialMenu;
