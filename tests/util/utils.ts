// Either someone can straight up call player.buildUnit. It's simpler and immediate (no tick required)
// Either someone can straight up call player.buildUnit. It's simpler and immediate (no tick required)
// However buildUnit do not create executions (e.g.: BattlecruiserExecution)
// If you also need execution use function below. Does not work with things not

import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { Game, Player, Unit, UnitType } from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";

// built via UI (e.g.: trade ships)
export function constructionExecution(
  game: Game,
  _owner: Player,
  x: number,
  y: number,
  unit: UnitType,
  ticks = 4,
) {
  game.addExecution(new ConstructionExecution(_owner, unit, game.ref(x, y)));

  // 4 ticks by default as it usually goes like this
  // Init of construction execution
  // Exec construction execution
  // Tick of construction execution which adds the execution related to the building/unit
  // First tick of the execution of the constructed building/unit
  // (sometimes step 3 and 4 are merged in one)

  for (let i = 0; i < ticks; i++) {
    game.executeNextTick();
  }
}

export function executeTicks(game: Game, numTicks: number): void {
  for (let i = 0; i < numTicks; i++) {
    game.executeNextTick();
  }
}

/**
 * Grant `player` a ready-to-launch Spaceport so AssaultShuttleExecution's
 * `diagnoseCanBuildAssaultShuttle` precondition (which now requires a
 * Spaceport) is satisfied in tests. Prefers a sector-edge border tile on
 * the same deep-space component as `target`, then any sector-edge border
 * tile, and finally any owned tile. `buildUnit` bypasses `canBuild`, so
 * the returned Spaceport is immediately active and not under construction.
 */
export function giveSpaceport(
  game: Game,
  player: Player,
  target?: TileRef,
): Unit {
  const targetComponent =
    target !== undefined ? game.getDeepSpaceComponent(target) : null;

  // Pass 1: border tile that is a sector edge on the same deep-space
  // component as the target.
  if (targetComponent !== null) {
    for (const t of player.borderTiles()) {
      if (!game.isSectorEdge(t)) continue;
      if (game.getDeepSpaceComponent(t) !== targetComponent) continue;
      return player.buildUnit(UnitType.Spaceport, t, {});
    }
  }

  // Pass 2: any border tile that is a sector edge.
  for (const t of player.borderTiles()) {
    if (game.isSectorEdge(t)) {
      return player.buildUnit(UnitType.Spaceport, t, {});
    }
  }

  // Pass 3: any tile the player owns. Tests with `disableNavMesh: true`
  // (the default in TestConfig) short-circuit getDeepSpaceComponent to 0,
  // so the precondition still passes with a non-edge tile.
  for (const t of player.tiles()) {
    return player.buildUnit(UnitType.Spaceport, t, {});
  }

  throw new Error("giveSpaceport: player owns no tiles");
}
