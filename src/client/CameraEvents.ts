/**
 * Camera navigation events — canonical location.
 *
 * Re-exported from hud/events.ts where they were first extracted (T6).
 * This module exists so non-HUD consumers (CameraController, ClientGameRunner)
 * have a clear, short import path.
 */
export {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./hud/events";
