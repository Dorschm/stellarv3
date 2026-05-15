import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { useHUDStore } from "../bridge/HUDStore";

/**
 * Issue #4 — capital-ship left-click decision logic, extracted from
 * `SpaceMapPlane.onPointerUp` so the precedence rules can be exercised
 * directly from unit tests without an R3F/canvas fixture.
 *
 * The helpers below are pure functions of the HUD snapshot and the
 * click tile coordinates. The component still owns the event-bus emit
 * and `setSelectedBattlecruiser` call; this module owns the decision.
 */

/**
 * Tile radius for the cap-ship click hit-test (Euclidean, not Manhattan
 * despite the legacy variable name).
 *
 * Why 12 and not 5: the visible Battlecruiser sprite renders at an
 * EMA-smoothed position that lags the true game tile by ~150ms (see
 * `SHIP_POSITION_SMOOTH_TAU_MS` in UnitRenderer.tsx) AND is drawn from a
 * 2×6 BoxGeometry that visually extends ~3 tiles from its centre. With
 * the camera tilted ~45° and the sprite floating above the map plane,
 * the user's click on the visible sprite raycast-resolves to a tile
 * that can sit 5-10 tiles away from the cruiser's actual game tile —
 * especially while the cruiser is moving. A radius of 5 was tight
 * enough that real users reported "select stopped working" because
 * their clicks landed just outside the disc.
 *
 * 12 tiles ≈ 452 sq-tile disc — comfortably covers the smoothing lag,
 * sprite extent, and camera-projection skew without making two adjacent
 * cruisers' hit zones overlap (cruisers move on void tiles which are
 * almost always >12 tiles apart in our procedural maps).
 */
export const BATTLECRUISER_CLICK_RADIUS_TILES = 12;

/** Minimal `Game`-like surface needed by the click helpers. */
export interface CapitalShipClickGame {
  x(t: TileRef): number;
  y(t: TileRef): number;
  ref(x: number, y: number): TileRef;
}

/**
 * Returns the unit id of an owned, active Battlecruiser whose tile lies
 * within {@link BATTLECRUISER_CLICK_RADIUS_TILES} of the click tile, or
 * `null` if no owned cap ship is near the click. When multiple cruisers
 * qualify, the one closest to the click (Euclidean squared distance)
 * wins. Reads the live unit snapshot from the HUD store.
 */
export function findOwnedBattlecruiserAtClick(
  hud: ReturnType<typeof useHUDStore.getState>,
  game: CapitalShipClickGame,
  clickTileX: number,
  clickTileY: number,
): number | null {
  const myPlayer = hud.myPlayer;
  if (myPlayer === null) return null;
  let bestId: number | null = null;
  let bestDistSq = Infinity;
  const r2 =
    BATTLECRUISER_CLICK_RADIUS_TILES * BATTLECRUISER_CLICK_RADIUS_TILES;
  for (const unit of hud.units.values()) {
    if (unit.type !== UnitType.Battlecruiser) continue;
    if (!unit.isActive) continue;
    if (unit.ownerSmallID !== myPlayer.smallID) continue;
    const ux = game.x(unit.tile);
    const uy = game.y(unit.tile);
    const dx = ux - clickTileX;
    const dy = uy - clickTileY;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 < bestDistSq) {
      bestDistSq = d2;
      bestId = unit.id;
    }
  }
  return bestId;
}

/**
 * Decision for a left-click on the map when capital-ship selection
 * precedence applies (i.e. before the modifier / alt / leftClickOpensMenu
 * gate). Three outcomes:
 *
 *   - `select` — click landed on (or near) an owned cap ship; selection
 *     should be pinned to `unitId`. Same-click on an already-selected
 *     cruiser preserves the selection; clicking a different friendly
 *     cruiser swaps.
 *   - `move` — no cap-ship hit, but a cruiser is currently selected;
 *     emit a move order to `tile` for the selected `unitId`.
 *   - `none` — no cap-ship hit and no cruiser selected; the caller must
 *     fall through to the normal click-action precedence
 *     (`resolveLeftClickAction`).
 */
export type CapitalShipClickAction =
  | { kind: "select"; unitId: number }
  | { kind: "move"; unitId: number; tile: TileRef }
  | { kind: "none" };

export function resolveCapitalShipClick(
  hud: ReturnType<typeof useHUDStore.getState>,
  game: CapitalShipClickGame,
  clickTileX: number,
  clickTileY: number,
): CapitalShipClickAction {
  const clickedUnitId = findOwnedBattlecruiserAtClick(
    hud,
    game,
    clickTileX,
    clickTileY,
  );
  if (clickedUnitId !== null) {
    return { kind: "select", unitId: clickedUnitId };
  }
  if (hud.selectedBattlecruiserUnitId !== null) {
    return {
      kind: "move",
      unitId: hud.selectedBattlecruiserUnitId,
      tile: game.ref(clickTileX, clickTileY),
    };
  }
  return { kind: "none" };
}
