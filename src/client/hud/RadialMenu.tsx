import React, { useCallback, useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { PlayerActions, Structures, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { PlayerView, UnitView } from "../../core/game/GameView";
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
  BuildUnitIntentEvent,
  SendAttackIntentEvent,
  SendJumpGateTeleportIntentEvent,
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
// Ticket 6 — Scout Swarm (launch) and Battlecruiser (build on ship) glyphs.
// Reuses existing assets so the radial menu additions don't require new art.
const scoutSwarmIcon = assetUrl("images/InfoIcon.svg");
const battlecruiserIcon = assetUrl("images/BattleshipIconWhite.svg");

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
 *       - Attack   → `SendAttackIntentEvent(targetID, population)`
 *       - Shuttle  → `SendShuttleAttackIntentEvent(tile, population)`
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
  // State for the destination-gate picker sub-panel shown after the player
  // clicks "Jump to gate". Cleared whenever the menu closes.
  const [gatePicker, setGatePicker] = useState<{
    unitId: number;
    sourceGateId: number;
    destinations: Array<{ id: number; label: string }>;
  } | null>(null);

  const hide = useCallback(() => {
    setIsVisible(false);
    setAnchor(null);
    setTile(null);
    setActions(null);
    setGatePicker(null);
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
        myPlayer.population() * ratio,
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
      new SendShuttleAttackIntentEvent(tile, myPlayer.population() * ratio),
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

  // GDD §5 Jump Gate — collect the player's active, ready gates.
  const myGates =
    myPlayer
      ?.units(UnitType.JumpGate)
      .filter((u) => u.isActive() && !u.isUnderConstruction()) ?? [];

  // Is the right-clicked tile sitting on one of the player's own gates?
  const gateAtTile =
    tile !== null ? myGates.find((g) => g.tile() === tile) : undefined;

  // Find the first non-structure unit the player owns at that gate tile
  // (this is the unit that will be teleported).
  const unitAtGateTile: UnitView | undefined =
    gateAtTile !== undefined && tile !== null
      ? myPlayer
          ?.units()
          .find(
            (u) =>
              u.tile() === tile && !Structures.has(u.type()) && u.isActive(),
          )
      : undefined;

  const canJumpGate =
    gateAtTile !== undefined &&
    unitAtGateTile !== undefined &&
    myGates.length >= 2;

  const jumpGateTooltip = !myPlayer
    ? undefined
    : gateAtTile === undefined
      ? "Right-click a tile with your Jump Gate"
      : unitAtGateTile === undefined
        ? "No unit at this gate to teleport"
        : myGates.length < 2
          ? "Need at least two Jump Gates"
          : `Jump to one of ${myGates.length - 1} available gate${myGates.length > 2 ? "s" : ""}`;

  // Ticket 6 — Scout Swarm launch. Launches a temporary swarm from the
  // player's nearest owned tile toward the clicked tile. The ScoutSwarm
  // BuildUnitIntent is wired straight to ConstructionExecution, which
  // delegates to ScoutSwarmExecution for spawn + cost + travel. We gate
  // the entry on "player exists and is out of the spawn phase" — the
  // affordability / target-validity checks are server-authoritative.
  const canLaunchScout = !!myPlayer && !gameView.inSpawnPhase();
  const handleLaunchScout = () => {
    if (!canLaunchScout) return;
    eventBus.emit(new BuildUnitIntentEvent(UnitType.ScoutSwarm, tile));
    hide();
  };

  // Ticket 6 — Build on Capital Ship. Opens the build menu anchored to a
  // nearby player-owned Battlecruiser's tile, so the ensuing
  // BuildUnitIntent targets coordinates the server's
  // `findHostBattlecruiser()` lookup will match. Only shown when such a
  // cruiser actually exists near the clicked tile — otherwise the entry
  // is a dead button.
  const hostCruiser =
    myPlayer === null
      ? null
      : (gameView
          .nearbyUnits(tile, 2, [UnitType.Battlecruiser])
          .find(({ unit }) => unit.owner() === myPlayer && unit.isActive())
          ?.unit ?? null);
  const canBuildOnCapitalShip =
    hostCruiser !== null && !gameView.inSpawnPhase();
  const handleBuildOnCapitalShip = () => {
    if (!canBuildOnCapitalShip || hostCruiser === null) return;
    // Re-anchor the build menu on the cruiser's tile so the subsequent
    // BuildUnitIntent's target coordinates are within range of
    // ConstructionExecution.findHostBattlecruiser(), which scans a
    // 2-tile radius around the intent tile.
    const cruiserTile = hostCruiser.tile();
    eventBus.emit(
      new ShowBuildMenuEvent(gameView.x(cruiserTile), gameView.y(cruiserTile)),
    );
    hide();
  };

  const handleJumpGate = () => {
    if (!canJumpGate || !gateAtTile || !unitAtGateTile) return;
    const destinations = myGates
      .filter((g) => g.id() !== gateAtTile.id())
      .map((g) => ({
        id: g.id(),
        label: `Gate at (${gameView.x(g.tile())}, ${gameView.y(g.tile())})`,
      }));
    if (destinations.length === 1) {
      // Only one destination — jump immediately without a picker.
      eventBus.emit(
        new SendJumpGateTeleportIntentEvent(
          unitAtGateTile.id(),
          gateAtTile.id(),
          destinations[0].id,
        ),
      );
      hide();
    } else {
      // Multiple destinations — open the sub-panel so the player can choose.
      setGatePicker({
        unitId: unitAtGateTile.id(),
        sourceGateId: gateAtTile.id(),
        destinations,
      });
    }
  };

  // -- Destination gate picker -----------------------------------------------
  if (gatePicker !== null) {
    return (
      <div
        className="fixed inset-0 z-[9500] pointer-events-auto"
        onClick={hide}
        onContextMenu={(e) => {
          e.preventDefault();
          hide();
        }}
        style={{ background: "rgba(0,0,0,0.18)" }}
      >
        <div
          className="absolute flex flex-col gap-2 p-3 rounded-xl bg-zinc-900/95 ring-1 ring-white/10 shadow-2xl shadow-black/50 min-w-48"
          style={{
            left: anchor!.x,
            top: anchor!.y,
            transform: "translate(-50%, -50%)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider pb-1 border-b border-white/10">
            Select destination gate
          </div>
          {gatePicker.destinations.map((dest) => (
            <button
              key={dest.id}
              className="flex items-center gap-2 px-3 py-2 rounded text-white text-sm bg-zinc-800 hover:bg-zinc-700 cursor-pointer transition-colors"
              onClick={() => {
                eventBus.emit(
                  new SendJumpGateTeleportIntentEvent(
                    gatePicker.unitId,
                    gatePicker.sourceGateId,
                    dest.id,
                  ),
                );
                hide();
              }}
            >
              <img src={jumpGateIcon} alt="" className="w-5 h-5" />
              <span>{dest.label}</span>
            </button>
          ))}
          <button
            className="flex items-center gap-2 px-3 py-2 rounded text-zinc-400 text-sm bg-zinc-800/50 hover:bg-zinc-700/50 cursor-pointer transition-colors mt-1"
            onClick={hide}
          >
            <span>Cancel</span>
          </button>
        </div>
      </div>
    );
  }

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

        {/*
         * Ticket 6 — Scout Swarm launch. Shown unconditionally so players
         * can discover it during a regular right-click; disabled in the
         * spawn phase where the intent would be rejected anyway.
         */}
        <RadialButton
          icon={scoutSwarmIcon}
          label={translateText("radial_menu.launch_scout") || "Launch Scout"}
          disabled={!canLaunchScout}
          onClick={handleLaunchScout}
        />

        {/*
         * Ticket 6 — Build on Capital Ship. Only rendered when a
         * player-owned Battlecruiser is within range of the clicked tile
         * (within the same 2-tile radius used by
         * ConstructionExecution.findHostBattlecruiser), so the entry is
         * discoverable exactly in the context where it applies.
         */}
        {hostCruiser !== null && (
          <RadialButton
            icon={battlecruiserIcon}
            label={
              translateText("radial_menu.build_on_capital_ship") ||
              "Build on Capital Ship"
            }
            disabled={!canBuildOnCapitalShip}
            onClick={handleBuildOnCapitalShip}
          />
        )}

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

export default RadialMenu;
