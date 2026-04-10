import React, { useCallback, useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { PlayerActions, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { PlayerView } from "../../core/game/GameView";
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
  SendShuttleAttackIntentEvent,
} from "../Transport";
import { translateText } from "../Utils";
import { CloseRadialMenuEvent, ShowPlayerPanelEvent } from "./events";

const attackIcon = assetUrl("images/SwordIconWhite.svg");
const shuttleIcon = assetUrl("images/ShuttleIconWhite.svg");
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");
// Jump Gate (GDD §5) — shares the anchor glyph used in BuildMenu so the
// "Jump to gate" radial entry visually matches the build option.
const jumpGateIcon = assetUrl("images/AnchorIcon.svg");

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
 *     Space attack, Shuttle attack. These are the same entry points previously
 *     reachable via the legacy radial menu.
 *   • On selection, it emits the same events the legacy flow produced:
 *       - Build    → `ShowBuildMenuEvent(tileX, tileY)`
 *       - Emoji    → `ShowEmojiMenuEvent(tileX, tileY)`
 *       - Player   → `ShowPlayerPanelEvent(actions, tile)`
 *       - Attack   → `SendAttackIntentEvent(targetID, troops)`
 *       - Shuttle  → `SendShuttleAttackIntentEvent(tile, troops)`
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

      // Request the AssaultShuttle buildable entry specifically — the rest
      // of the menu doesn't read buildableUnits, and passing `null` forces
      // GameRunner.playerActions to return an empty array, which would make
      // the Shuttle button permanently unusable (no rejectReason surfaced).
      myPlayer
        .actions(clickedTile, [UnitType.AssaultShuttle])
        .then((resolved) => {
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

  const handleShuttle = () => {
    if (!myPlayer) {
      showShuttleError("Shuttle attack: no local player");
      return;
    }

    // Actions haven't resolved yet — the buildableUnits request is still
    // in flight from the worker. Tell the user rather than silently doing
    // nothing.
    if (actions === null) {
      showShuttleError("Shuttle attack: still loading target info, try again");
      return;
    }

    const shuttleBuildable = actions.buildableUnits.find(
      (bu) => bu.type === UnitType.AssaultShuttle,
    );

    if (shuttleBuildable === undefined) {
      // buildableUnits didn't include a shuttle entry at all. This is a
      // bug in whatever populated actions (the radial menu requests the
      // shuttle type explicitly, so it should always be present).
      showShuttleError(
        "Shuttle attack: AssaultShuttle missing from buildables — report this",
      );
      return;
    }

    if (shuttleBuildable.canBuild === false) {
      const tag = shuttleBuildable.rejectReason;
      const friendly = tag
        ? humanReadableShuttleReason(tag)
        : "Cannot launch (no reason reported — likely still in spawn phase or Assault Shuttle disabled in lobby)";
      showShuttleError(
        tag
          ? `Shuttle attack: ${friendly} [${tag}]`
          : `Shuttle attack: ${friendly}`,
      );
      // Also log a structured diagnostic so the user can inspect it.

      console.warn("[RadialMenu] Shuttle attack blocked", {
        rejectReason: tag ?? null,
        tile,
        target: ownerPlayer?.displayName() ?? "unowned",
        inSpawnPhase: gameView.inSpawnPhase(),
        isSpawnImmunityActive: gameView.isSpawnImmunityActive(),
      });
      return;
    }

    const percent = useHUDStore.getState().attackRatio;
    const ratio = Math.max(0, Math.min(100, percent)) / 100;
    eventBus.emit(
      new SendShuttleAttackIntentEvent(tile, myPlayer.troops() * ratio),
    );
    hide();
  };

  const canAttack = !!actions?.canAttack;
  const shuttleBuildable = actions?.buildableUnits.find(
    (bu) => bu.type === UnitType.AssaultShuttle,
  );
  const shuttleDisabledReason =
    shuttleBuildable?.canBuild === false && shuttleBuildable.rejectReason
      ? humanReadableShuttleReason(shuttleBuildable.rejectReason)
      : undefined;
  const canEmoji = ownerIsPlayer;
  const canOpenPlayerPanel = ownerIsPlayer && actions !== null;
  const canBuild = !gameView.inSpawnPhase();

  // GDD §5 Jump Gate — collect the player's available gates so the "Jump to
  // gate" entry can show a count and be greyed out when the player has fewer
  // than two ready endpoints. Gates that are still under construction are
  // excluded so a partially-built gate isn't counted as a usable destination.
  const myGates =
    myPlayer
      ?.units(UnitType.JumpGate)
      .filter((u) => u.isActive() && !u.isUnderConstruction()) ?? [];
  const canJumpGate = myGates.length >= 2;
  const jumpGateTooltip = !myPlayer
    ? undefined
    : myGates.length === 0
      ? "Build a Jump Gate first"
      : myGates.length === 1
        ? "Need at least two Jump Gates"
        : `${myGates.length} gates available`;

  const handleJumpGate = () => {
    if (!canJumpGate) return;
    // Surface the available gates in a toast. Full intent wiring (select
    // unit + source/destination gates over the network) is left to a
    // follow-up — JumpGateTravel.teleport already handles the server-side
    // logic, so the next step is just plumbing through Transport.
    showJumpGateInfo(
      `Jump Gate: ${myGates.length} ready endpoints. Right-click a unit on a gate to jump.`,
    );
    hide();
  };

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

        {/*
         * Shuttle attack is intentionally always clickable so that players
         * (and devs) can troubleshoot when a launch is blocked. The click
         * handler diagnoses `rejectReason` and surfaces it as a toast; the
         * native `title` still shows the same reason on hover when one is
         * known.
         */}
        <RadialButton
          icon={shuttleIcon}
          label={translateText("radial_menu.shuttle") || "Shuttle attack"}
          disabled={false}
          onClick={handleShuttle}
          color="bg-sky-700/80 hover:bg-sky-600/80"
          tooltip={shuttleDisabledReason}
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

        <RadialButton
          icon={jumpGateIcon}
          label={translateText("radial_menu.jump_gate") || "Jump to gate"}
          disabled={!canJumpGate}
          onClick={handleJumpGate}
          tooltip={jumpGateTooltip}
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
  /**
   * Optional native tooltip shown on hover — used to explain *why* a
   * button is disabled (e.g. which Assault Shuttle precondition failed).
   */
  tooltip?: string;
}

function RadialButton({
  icon,
  label,
  disabled,
  onClick,
  color,
  tooltip,
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
      title={tooltip}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <img src={icon} alt="" className="w-5 h-5" />
      <span>{label}</span>
      {disabled && tooltip ? (
        <span className="ml-auto text-[10px] text-zinc-400 italic">
          {tooltip}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Map an AssaultShuttle `rejectReason` tag (from {@link AssaultShuttleRejection}
 * in AssaultShuttleUtils) to a short human-readable explanation. Kept inline
 * here rather than in the i18n bundle because these are dev-facing diagnostics
 * — they describe internal pathing preconditions and will rarely be seen by
 * regular players once the ruleset stabilises.
 */
function humanReadableShuttleReason(reason: string): string {
  switch (reason) {
    case "max_shuttles_in_flight":
      return "Max shuttles already in flight";
    case "target_has_no_sector_edge":
      return "Target planet has no reachable edge";
    case "target_is_self":
      return "Can't shuttle to your own territory";
    case "target_is_ally_or_immune":
      return "Target is allied or immune";
    case "no_spaceport":
      return "Build a Spaceport first — shuttles launch from Spaceports";
    case "no_deep_space_path":
      return "No deep-space path from your nearest Spaceport";
    default:
      return reason;
  }
}

/**
 * Show a red toast via the existing `show-message` custom event the
 * HeadsUpMessage component listens for. Kept local to the radial menu so
 * the Shuttle button can explain *why* a launch was blocked instead of
 * silently doing nothing.
 */
function showShuttleError(message: string): void {
  window.dispatchEvent(
    new CustomEvent("show-message", {
      detail: { message, color: "red", duration: 4000 },
    }),
  );
}

/**
 * Show a neutral toast for Jump Gate informational messages. Uses the same
 * `show-message` channel as the shuttle errors but with a non-error colour
 * so the message reads as a status notification rather than a failure.
 */
function showJumpGateInfo(message: string): void {
  window.dispatchEvent(
    new CustomEvent("show-message", {
      detail: { message, color: "blue", duration: 4000 },
    }),
  );
}

export default RadialMenu;
