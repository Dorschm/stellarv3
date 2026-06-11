import { EventBus } from "../../core/EventBus";
import { PlayerBuildableUnitType, UnitType } from "../../core/game/Game";
import { UserSettings } from "../../core/game/UserSettings";
import { ShowSettingsModalEvent } from "../hud/events";
import {
  AlternateViewEvent,
  AttackRatioEvent,
  CenterCameraEvent,
  CloseViewEvent,
  ConfirmGhostStructureEvent,
  DoShuttleAttackEvent,
  DoSpaceAttackEvent,
  DragEvent,
  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  GhostStructureChangedEvent,
  MouseMoveEvent,
  RefreshGraphicsEvent,
  SwapRocketDirectionEvent,
  ToggleCoordinateGridEvent,
  TogglePauseIntentEvent,
  TogglePerformanceOverlayEvent,
  ZoomEvent,
} from "../InputHandler";
import { Platform } from "../Platform";
import { BuildUnitIntentEvent } from "../Transport";
import { translateText } from "../Utils";
import { useHUDStore } from "./HUDStore";

/**
 * Issue #7 — structures that can be built directly onto a selected cap
 * ship via the number-key hotkeys. Mirrors
 * `Config.battlecruiserHostableStructures` but the client can't read the
 * authoritative server config at this layer, so we keep a parallel list.
 * If the server config diverges, a stale entry simply falls through to
 * the existing ghost-structure flow (no breakage, just no auto-host).
 */
const BATTLECRUISER_HOSTABLE_CLIENT: ReadonlySet<UnitType> = new Set([
  UnitType.Colony,
  UnitType.Foundry,
  UnitType.Spaceport,
  UnitType.DefenseStation,
  UnitType.OrbitalStrikePlatform,
  UnitType.PointDefenseArray,
]);

/**
 * Minimal shape of a pointer-like event we need for modifier checks. Kept
 * structural so both PointerEvent and React's ThreeEvent nativeEvent work.
 */
export interface ModifierEventLike {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Load keybinds from localStorage, falling back to defaults. Extracted as a
 * top-level helper so both SpaceInputHandler and pointer-event emitters
 * (e.g. SpaceMapPlane) can resolve the configured modifierKey / altKey.
 */
export function loadKeybinds(): Record<string, string> {
  let saved: Record<string, string> = {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem("settings.keybinds") ?? "{}",
    );
    saved = Object.fromEntries(
      Object.entries(parsed)
        .map(([k, v]) => {
          let val: unknown;
          if (v && typeof v === "object" && "value" in v) {
            val = (v as { value: unknown }).value;
          } else {
            val = v;
          }
          if (typeof val !== "string") return [k, undefined];
          return [k, val];
        })
        .filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } catch (e) {
    console.warn("Invalid keybinds JSON:", e);
  }

  const isMac = Platform.isMac;

  return {
    toggleView: "Space",
    coordinateGrid: "KeyM",
    centerCamera: "KeyC",
    moveUp: "KeyW",
    moveDown: "KeyS",
    moveLeft: "KeyA",
    moveRight: "KeyD",
    zoomOut: "KeyQ",
    zoomIn: "KeyE",
    attackRatioDown: "KeyT",
    attackRatioUp: "KeyY",
    shuttleAttack: "KeyB",
    spaceAttack: "KeyG",
    swapDirection: "KeyU",
    modifierKey: isMac ? "MetaLeft" : "ControlLeft",
    altKey: "AltLeft",
    buildColony: "Digit1",
    buildFoundry: "Digit2",
    buildSpaceport: "Digit3",
    buildDefenseStation: "Digit4",
    buildOrbitalStrikePlatform: "Digit5",
    buildPointDefenseArray: "Digit6",
    buildBattlecruiser: "Digit7",
    buildAntimatterTorpedo: "Digit8",
    buildNovaBomb: "Digit9",
    buildClusterWarhead: "Digit0",
    pauseGame: "KeyP",
    gameSpeedUp: "Period",
    gameSpeedDown: "Comma",
    ...saved,
  };
}

/**
 * Evaluate whether the configured `modifierKey` keybind is pressed on a
 * pointer event. Mirrors the legacy `InputHandler.isModifierKeyPressed`
 * semantics so keybind remaps propagate to the R3F pointer pipeline.
 */
export function isModifierKeyPressed(
  event: ModifierEventLike,
  keybinds: Record<string, string>,
): boolean {
  const key = keybinds.modifierKey;
  return (
    ((key === "AltLeft" || key === "AltRight") && event.altKey) ||
    ((key === "ControlLeft" || key === "ControlRight") && event.ctrlKey) ||
    ((key === "ShiftLeft" || key === "ShiftRight") && event.shiftKey) ||
    ((key === "MetaLeft" || key === "MetaRight") && event.metaKey)
  );
}

/**
 * Evaluate whether the configured `altKey` keybind is pressed on a pointer
 * event. Mirrors the legacy `InputHandler.isAltKeyPressed` semantics.
 */
export function isAltKeyPressed(
  event: ModifierEventLike,
  keybinds: Record<string, string>,
): boolean {
  const key = keybinds.altKey;
  return (
    ((key === "AltLeft" || key === "AltRight") && event.altKey) ||
    ((key === "ControlLeft" || key === "ControlRight") && event.ctrlKey) ||
    ((key === "ShiftLeft" || key === "ShiftRight") && event.shiftKey) ||
    ((key === "MetaLeft" || key === "MetaRight") && event.metaKey)
  );
}

/**
 * Keyboard-only input handler for the new React/R3F pipeline.
 *
 * Pointer / touch / scroll input is handled by R3F's built-in pointer
 * events and the OrbitControls drei helper, so this class only manages
 * keyboard shortcuts (pan, zoom, build hotkeys, attack ratio, etc.).
 *
 * It reads `ghostStructure` from the HUDStore instead of a mutable
 * UIState object.
 */
export class SpaceInputHandler {
  private activeKeys = new Set<string>();
  private keybinds: Record<string, string> = {};
  private moveInterval: ReturnType<typeof setInterval> | null = null;
  private alternateView = false;
  private coordinateGridEnabled = false;

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;
  private readonly userSettings: UserSettings = new UserSettings();

  constructor(private eventBus: EventBus) {}

  initialize(): void {
    this.loadKeybinds();
    this.startMovementLoop();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  destroy(): void {
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
    this.activeKeys.clear();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mousemove", this.onMouseMove);
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private loadKeybinds(): void {
    this.keybinds = loadKeybinds();
  }

  private startMovementLoop(): void {
    this.moveInterval = setInterval(() => {
      if (this.activeKeys.has("ShiftLeft") || this.activeKeys.has("ShiftRight"))
        return;

      let deltaX = 0;
      let deltaY = 0;

      if (
        this.activeKeys.has(this.keybinds.moveUp) ||
        this.activeKeys.has("ArrowUp")
      )
        deltaY += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveDown) ||
        this.activeKeys.has("ArrowDown")
      )
        deltaY -= this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveLeft) ||
        this.activeKeys.has("ArrowLeft")
      )
        deltaX += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveRight) ||
        this.activeKeys.has("ArrowRight")
      )
        deltaX -= this.PAN_SPEED;

      if (deltaX || deltaY) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        this.activeKeys.has(this.keybinds.zoomOut) ||
        this.activeKeys.has("Minus") ||
        this.activeKeys.has("NumpadSubtract")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.activeKeys.has(this.keybinds.zoomIn) ||
        this.activeKeys.has("Equal") ||
        this.activeKeys.has("NumpadAdd")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 1);
  }

  // -- Bound event handlers --

  private onMouseMove = (e: globalThis.MouseEvent): void => {
    if (e.movementX || e.movementY) {
      this.eventBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
    }
  };

  private onBlur = (): void => {
    this.activeKeys.clear();
    if (this.alternateView) {
      this.alternateView = false;
      this.eventBus.emit(new AlternateViewEvent(false));
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTextInputTarget(e.target)) {
      if (e.code !== "Escape") return;
    }

    if (e.code === this.keybinds.toggleView) {
      e.preventDefault();
      if (!this.alternateView) {
        this.alternateView = true;
        this.eventBus.emit(new AlternateViewEvent(true));
      }
    }

    if (e.code === this.keybinds.coordinateGrid && !e.repeat) {
      e.preventDefault();
      this.coordinateGridEnabled = !this.coordinateGridEnabled;
      this.eventBus.emit(
        new ToggleCoordinateGridEvent(this.coordinateGridEnabled),
      );
    }

    if (e.code === "Escape") {
      e.preventDefault();

      // Snapshot gate mode before CloseViewEvent (which synchronously
      // resets it via ClientGameRunner.onCloseView).
      const wasInGateMode = useHUDStore.getState().jumpGateMode !== "idle";

      // Issue #4 — Esc clears Capital Ship selection BEFORE the
      // ghost-structure clear path so a player who selected a cruiser by
      // accident can dismiss it without also discarding their ghost.
      const hud = useHUDStore.getState();
      if (hud.selectedBattlecruiserUnitId !== null) {
        hud.setSelectedBattlecruiser(null);
        return;
      }

      // Close any open overlays first (RadialMenu, BuildMenu, etc.).
      this.eventBus.emit(new CloseViewEvent());

      // Jump Gate selection mode: Escape cancels gate mode without
      // opening the settings modal. CloseViewEvent already cleared the
      // gate state, so just return.
      if (wasInGateMode) {
        return;
      }

      const currentGhost = useHUDStore.getState().ghostStructure;
      if (currentGhost !== null) {
        // If a build ghost is active, just clear it — don't open settings.
        this.setGhostStructure(null);
      } else {
        // No ghost structure to clear → open/toggle the settings modal
        // (same ShowSettingsModalEvent used by the gear icon in
        // GameRightSidebar). SettingsModal's own Escape keydown handler
        // closes it when already visible, giving toggle semantics.
        this.eventBus.emit(new ShowSettingsModalEvent(true));
      }
    }

    // Read ghostStructure from HUD store
    const ghostStructure = useHUDStore.getState().ghostStructure;
    if (
      (e.code === "Enter" || e.code === "NumpadEnter") &&
      ghostStructure !== null
    ) {
      e.preventDefault();
      this.eventBus.emit(new ConfirmGhostStructureEvent());
    }

    const isBrowserZoomCombo =
      (e.metaKey || e.ctrlKey) &&
      (e.code === "Minus" ||
        e.code === "Equal" ||
        e.code === "NumpadAdd" ||
        e.code === "NumpadSubtract");

    if (
      !isBrowserZoomCombo &&
      [
        this.keybinds.moveUp,
        this.keybinds.moveDown,
        this.keybinds.moveLeft,
        this.keybinds.moveRight,
        this.keybinds.zoomOut,
        this.keybinds.zoomIn,
        "ArrowUp",
        "ArrowLeft",
        "ArrowDown",
        "ArrowRight",
        "Minus",
        "Equal",
        "NumpadAdd",
        "NumpadSubtract",
        this.keybinds.attackRatioDown,
        this.keybinds.attackRatioUp,
        this.keybinds.centerCamera,
        "ControlLeft",
        "ControlRight",
        "ShiftLeft",
        "ShiftRight",
      ].includes(e.code)
    ) {
      this.activeKeys.add(e.code);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.isTextInputTarget(e.target) && !this.activeKeys.has(e.code)) {
      return;
    }

    // Clear stuck zoom keys when modifier is released
    if (
      e.code === "MetaLeft" ||
      e.code === "MetaRight" ||
      e.code === "ControlLeft" ||
      e.code === "ControlRight"
    ) {
      this.activeKeys.delete("Minus");
      this.activeKeys.delete("Equal");
      this.activeKeys.delete("NumpadAdd");
      this.activeKeys.delete("NumpadSubtract");
      this.activeKeys.delete(this.keybinds.zoomIn);
      this.activeKeys.delete(this.keybinds.zoomOut);
    }

    if (e.code === this.keybinds.toggleView) {
      e.preventDefault();
      this.alternateView = false;
      this.eventBus.emit(new AlternateViewEvent(false));
    }

    const resetKey = this.keybinds.resetGfx ?? "KeyR";
    if (e.code === resetKey && this.isAltKeyHeld(e)) {
      e.preventDefault();
      this.eventBus.emit(new RefreshGraphicsEvent());
    }

    if (e.code === this.keybinds.shuttleAttack) {
      e.preventDefault();
      this.eventBus.emit(new DoShuttleAttackEvent());
    }

    if (e.code === this.keybinds.spaceAttack) {
      e.preventDefault();
      this.eventBus.emit(new DoSpaceAttackEvent());
    }

    if (e.code === this.keybinds.attackRatioDown) {
      e.preventDefault();
      const increment = this.userSettings.attackRatioIncrement();
      this.eventBus.emit(new AttackRatioEvent(-increment));
    }

    if (e.code === this.keybinds.attackRatioUp) {
      e.preventDefault();
      const increment = this.userSettings.attackRatioIncrement();
      this.eventBus.emit(new AttackRatioEvent(increment));
    }

    if (e.code === this.keybinds.centerCamera) {
      e.preventDefault();
      this.eventBus.emit(new CenterCameraEvent());
    }

    const matchedBuild = this.resolveBuildKeybind(e.code);
    if (matchedBuild !== null) {
      e.preventDefault();

      // Issue #7 — when a Capital Ship is selected and the resolved
      // structure is hostable on a cap ship, route the build through the
      // host-only intent path. We validate ownership, liveness, and slot
      // occupancy on the client so the player gets immediate feedback,
      // then pass `hostBattlecruiserId` along so the server rejects rather
      // than falling back to ground placement if state diverges in flight.
      const hud = useHUDStore.getState();
      const selectedId = hud.selectedBattlecruiserUnitId;
      const isHostable = BATTLECRUISER_HOSTABLE_CLIENT.has(matchedBuild);
      if (selectedId !== null && isHostable) {
        const cruiser = hud.units.get(selectedId);
        const myPlayer = hud.myPlayer;
        const stale =
          cruiser === undefined ||
          cruiser.type !== UnitType.Battlecruiser ||
          !cruiser.isActive ||
          myPlayer === null ||
          cruiser.ownerSmallID !== myPlayer.smallID;
        if (stale) {
          // Selection stale (cruiser destroyed / captured / spectating).
          // Clear the selection and consume the hotkey — do NOT fall
          // through to the ground-build ghost flow, otherwise a stale
          // selected-cruiser hotkey could silently build on the ground.
          hud.setSelectedBattlecruiser(null);
          window.dispatchEvent(
            new CustomEvent("show-message", {
              detail: {
                message: "Capital ship no longer available",
                color: "red",
                duration: 2000,
              },
            }),
          );
          return;
        }
        if (cruiser!.hasSlottedStructure) {
          // Slot occupied — show an immediate toast and consume the
          // hotkey. Don't fall through to ground placement, otherwise a
          // selected-cruiser hotkey could silently build on the ground.
          window.dispatchEvent(
            new CustomEvent("show-message", {
              detail: {
                message: "Slot occupied",
                color: "red",
                duration: 2000,
              },
            }),
          );
          return;
        }
        // Issue #7 — affordability feedback. Without this, a player
        // hitting a structure hotkey on a selected empty-slot cruiser
        // while broke would see *nothing*: the server-side host-only
        // path rejects without falling back to ground placement, and
        // the only trace was a `console.warn`. Reuse the BuildMenu
        // wording so the rejection feels consistent.
        const cost = hud.cruiserHostableCosts.get(matchedBuild);
        if (cost !== undefined && myPlayer!.credits < cost) {
          window.dispatchEvent(
            new CustomEvent("show-message", {
              detail: {
                message: translateText("build_menu.not_enough_money"),
                color: "red",
                duration: 2000,
              },
            }),
          );
          return;
        }
        this.eventBus.emit(
          new BuildUnitIntentEvent(
            matchedBuild,
            cruiser!.tile,
            undefined,
            cruiser!.id,
          ),
        );
        return;
      }

      // Non-hostable hotkey, or no capital ship selected — fall through
      // to the existing ghost-structure flow for ground placement.
      this.setGhostStructure(matchedBuild);
    }

    if (e.code === this.keybinds.swapDirection) {
      e.preventDefault();
      // The HUDStore is the single source of truth for rocket direction —
      // the PlayerPanel toggle flips it too (via GameBridge's
      // SwapRocketDirectionEvent listener), so deriving the next value from
      // the store keeps the hotkey and the panel button in phase.
      const next = !useHUDStore.getState().rocketDirectionUp;
      this.eventBus.emit(new SwapRocketDirectionEvent(next));
    }

    if (!e.repeat && e.code === this.keybinds.pauseGame) {
      e.preventDefault();
      this.eventBus.emit(new TogglePauseIntentEvent());
    }
    if (!e.repeat && e.code === this.keybinds.gameSpeedUp) {
      e.preventDefault();
      this.eventBus.emit(new GameSpeedUpIntentEvent());
    }
    if (!e.repeat && e.code === this.keybinds.gameSpeedDown) {
      e.preventDefault();
      this.eventBus.emit(new GameSpeedDownIntentEvent());
    }

    if (e.code === "KeyD" && e.shiftKey) {
      e.preventDefault();
      this.eventBus.emit(new TogglePerformanceOverlayEvent());
    }

    this.activeKeys.delete(e.code);
  };

  // -- Ghost structure --

  private setGhostStructure(gs: PlayerBuildableUnitType | null): void {
    this.eventBus.emit(new GhostStructureChangedEvent(gs));
  }

  // -- Build keybind resolution (same logic as old InputHandler) --

  private digitFromKeyCode(code: string): string | null {
    if (
      code?.length === 6 &&
      code.startsWith("Digit") &&
      /^[0-9]$/.test(code[5])
    )
      return code[5];
    if (
      code?.length === 7 &&
      code.startsWith("Numpad") &&
      /^[0-9]$/.test(code[6])
    )
      return code[6];
    return null;
  }

  private resolveBuildKeybind(code: string): PlayerBuildableUnitType | null {
    const buildKeybinds: ReadonlyArray<{
      key: string;
      type: PlayerBuildableUnitType;
    }> = [
      { key: "buildColony", type: UnitType.Colony },
      { key: "buildFoundry", type: UnitType.Foundry },
      { key: "buildSpaceport", type: UnitType.Spaceport },
      { key: "buildDefenseStation", type: UnitType.DefenseStation },
      {
        key: "buildOrbitalStrikePlatform",
        type: UnitType.OrbitalStrikePlatform,
      },
      { key: "buildPointDefenseArray", type: UnitType.PointDefenseArray },
      { key: "buildAntimatterTorpedo", type: UnitType.AntimatterTorpedo },
      { key: "buildNovaBomb", type: UnitType.NovaBomb },
      { key: "buildBattlecruiser", type: UnitType.Battlecruiser },
      { key: "buildClusterWarhead", type: UnitType.ClusterWarhead },
    ];
    for (const { key, type } of buildKeybinds) {
      if (code === this.keybinds[key]) return type;
    }
    for (const { key, type } of buildKeybinds) {
      const digit = this.digitFromKeyCode(code);
      const bindDigit = this.digitFromKeyCode(this.keybinds[key]);
      if (digit !== null && bindDigit !== null && digit === bindDigit)
        return type;
    }
    return null;
  }

  // -- Helpers --

  private isTextInputTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
    if (el.tagName === "INPUT") {
      return (el as HTMLInputElement).type !== "range";
    }
    return false;
  }

  private isAltKeyHeld(event: KeyboardEvent): boolean {
    if (
      this.keybinds.altKey === "AltLeft" ||
      this.keybinds.altKey === "AltRight"
    )
      return event.altKey && !event.ctrlKey;
    if (
      this.keybinds.altKey === "ControlLeft" ||
      this.keybinds.altKey === "ControlRight"
    )
      return event.ctrlKey;
    if (
      this.keybinds.altKey === "ShiftLeft" ||
      this.keybinds.altKey === "ShiftRight"
    )
      return event.shiftKey;
    if (
      this.keybinds.altKey === "MetaLeft" ||
      this.keybinds.altKey === "MetaRight"
    )
      return event.metaKey;
    return false;
  }
}
