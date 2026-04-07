import { SpatialQuery } from "../pathfinding/spatial/SpatialQuery";
import { Game, Player, UnitType } from "./Game";
import { TileRef } from "./GameMap";

export function canBuildAssaultShuttle(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | false {
  if (
    player.unitCount(UnitType.AssaultShuttle) >=
    game.config().shuttleMaxNumber()
  ) {
    return false;
  }

  const dst = targetShuttleTile(game, tile);
  if (dst === null) {
    return false;
  }

  const other = game.owner(tile);
  if (other === player) {
    return false;
  }
  if (other.isPlayer() && !player.canAttackPlayer(other)) {
    return false;
  }

  const spatial = new SpatialQuery(game);
  return spatial.closestSectorEdgeByWater(player, dst) ?? false;
}

export function targetShuttleTile(gm: Game, tile: TileRef): TileRef | null {
  const spatial = new SpatialQuery(gm);
  return spatial.closestSectorEdge(gm.owner(tile), tile);
}

export function bestSectorEdgeDeploymentSource(
  gm: Game,
  player: Player,
  dst: TileRef,
): TileRef | null {
  const spatial = new SpatialQuery(gm);
  return spatial.closestSectorEdgeByWater(player, dst);
}
