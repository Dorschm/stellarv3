/**
 * Pure helper that resolves which left-click action should fire on the map
 * plane, given the current HUD / settings snapshot. Extracted from
 * `SpaceMapPlane.onPointerUp` so the precedence rules are unit-testable
 * without a DOM/R3F/canvas fixture.
 *
 * Precedence (highest first):
 *   1. Jump Gate selection mode → `mouseUp` (gate click routing)
 *   2. Configured modifier key held → `buildMenu`
 *   3. Configured alt key held → `emojiMenu`
 *   4. `leftClickOpensMenu` setting enabled (and shift not held) → `contextMenu`
 *   5. Default → `mouseUp`
 */

export type LeftClickAction =
  | "mouseUp"
  | "buildMenu"
  | "emojiMenu"
  | "contextMenu";

export interface LeftClickInput {
  jumpGateMode: "idle" | "selectSource" | "selectDest";
  modifierPressed: boolean;
  altPressed: boolean;
  leftClickOpensMenu: boolean;
  shiftKey: boolean;
}

export function resolveLeftClickAction(input: LeftClickInput): LeftClickAction {
  if (input.jumpGateMode !== "idle") return "mouseUp";
  if (input.modifierPressed) return "buildMenu";
  if (input.altPressed) return "emojiMenu";
  if (input.leftClickOpensMenu && !input.shiftKey) return "contextMenu";
  return "mouseUp";
}
