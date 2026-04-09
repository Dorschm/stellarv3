import { SpatialQuery } from "../pathfinding/spatial/SpatialQuery";
import { findClosestBy } from "../Util";
import { Game, Player, UnitType } from "./Game";
import { TileRef } from "./GameMap";

/**
 * Reasons {@link canBuildAssaultShuttle} can return false. Exposed so the
 * UI layer can surface a human-readable explanation when the Shuttle
 * button is disabled.
 */
export type AssaultShuttleRejection =
  | "max_shuttles_in_flight"
  | "target_has_no_sector_edge"
  | "target_is_self"
  | "target_is_ally_or_immune"
  | "no_spaceport"
  | "no_deep_space_path";

export function canBuildAssaultShuttle(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | false {
  return diagnoseCanBuildAssaultShuttle(game, player, tile).result;
}

/**
 * Full diagnostic variant of {@link canBuildAssaultShuttle}. Returns both
 * the spawn tile (or false) and, on rejection, which precondition failed.
 * Call sites that only care about the boolean can use
 * {@link canBuildAssaultShuttle}; the UI layer uses this to tell the player
 * *why* the button is unavailable.
 *
 * Assault Shuttles are launched from the attacker's nearest ready
 * Spaceport. The returned `result` tile is that Spaceport's tile — the
 * shuttle spawns there and pathfinds across deep space to the target.
 */
export function diagnoseCanBuildAssaultShuttle(
  game: Game,
  player: Player,
  tile: TileRef,
): { result: TileRef | false; reason?: AssaultShuttleRejection } {
  if (
    player.unitCount(UnitType.AssaultShuttle) >=
    game.config().shuttleMaxNumber()
  ) {
    return { result: false, reason: "max_shuttles_in_flight" };
  }

  const dst = targetShuttleTile(game, tile);
  if (dst === null) {
    return { result: false, reason: "target_has_no_sector_edge" };
  }

  const other = game.owner(tile);
  if (other === player) {
    return { result: false, reason: "target_is_self" };
  }
  if (other.isPlayer() && !player.canAttackPlayer(other)) {
    return { result: false, reason: "target_is_ally_or_immune" };
  }

  // Assault Shuttles can only launch from an active Spaceport. Pick the
  // closest ready spaceport to the destination so shuttles travel the
  // shortest deep-space distance.
  const portTile = nearestReadySpaceportTo(game, player, dst);
  if (portTile === null) {
    return { result: false, reason: "no_spaceport" };
  }

  // Verify the chosen spaceport and the target are on the same deep-space
  // component — otherwise no water path exists between them.
  if (!shareDeepSpaceComponent(game, portTile, dst)) {
    return { result: false, reason: "no_deep_space_path" };
  }

  return { result: portTile };
}

export function targetShuttleTile(gm: Game, tile: TileRef): TileRef | null {
  const spatial = new SpatialQuery(gm);
  return spatial.closestSectorEdge(gm.owner(tile), tile);
}

/**
 * Return the tile of the player's closest active, ready-to-launch
 * Spaceport measured in manhattan distance from `target`, or null if no
 * such Spaceport exists. "Ready" = active and not under construction.
 */
export function nearestReadySpaceportTo(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef | null {
  const port = findClosestBy(
    player.units(UnitType.Spaceport),
    (p) => gm.manhattanDist(p.tile(), target),
    (p) => p.isActive() && !p.isUnderConstruction(),
  );
  return port?.tile() ?? null;
}

/**
 * Retreat deployment source. Returns the nearest ready Spaceport tile so
 * retreating shuttles route back to their home port. Returns null when
 * the (possibly new, post-capture) owner has no ready spaceports — the
 * caller is expected to gracefully delete/refund the shuttle in that
 * case.
 */
export function bestSectorEdgeDeploymentSource(
  gm: Game,
  player: Player,
  dst: TileRef,
): TileRef | null {
  return nearestReadySpaceportTo(gm, player, dst);
}

function shareDeepSpaceComponent(gm: Game, a: TileRef, b: TileRef): boolean {
  const ca = gm.getDeepSpaceComponent(a);
  const cb = gm.getDeepSpaceComponent(b);
  if (ca === null || cb === null) return false;
  return ca === cb;
}
