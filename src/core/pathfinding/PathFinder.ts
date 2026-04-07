import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { TradeHub } from "../game/TradeHub";
import { AStarDeepSpace } from "./algorithms/AStar.DeepSpace";
import { AStarHyperspaceLane } from "./algorithms/AStar.HyperspaceLane";
import { AirPathFinder } from "./PathFinder.Air";
import {
  ParabolaOptions,
  ParabolaUniversalPathFinder,
} from "./PathFinder.Parabola";
import { StationPathFinder } from "./PathFinder.Station";
import { PathFinderBuilder } from "./PathFinderBuilder";
import { StepperConfig } from "./PathFinderStepper";
import { ComponentCheckTransformer } from "./transformers/ComponentCheckTransformer";
import { MiniMapTransformer } from "./transformers/MiniMapTransformer";
import { SectorBoundaryCoercingTransformer } from "./transformers/SectorBoundaryCoercingTransformer";
import { SmoothingDeepSpaceTransformer } from "./transformers/SmoothingDeepSpaceTransformer";
import { PathStatus, SteppingPathFinder } from "./types";

/**
 * Pathfinders that work with GameMap - usable in both simulation and UI layers
 */
export class UniversalPathFinding {
  static Parabola(
    gameMap: GameMap,
    options?: ParabolaOptions,
  ): ParabolaUniversalPathFinder {
    return new ParabolaUniversalPathFinder(gameMap, options);
  }
}

/**
 * Pathfinders that require Game - simulation layer only
 */
export class PathFinding {
  static Water(game: Game): SteppingPathFinder<TileRef> {
    const pf = game.miniDeepSpaceHPA();
    const graph = game.miniDeepSpaceGraph();

    if (!pf || !graph || graph.nodeCount < 100) {
      return PathFinding.WaterSimple(game);
    }

    const miniMap = game.miniMap();
    const componentCheckFn = (t: TileRef) => graph.getComponentId(t);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new ComponentCheckTransformer(pf, componentCheckFn))
      .wrap((pf) => new SmoothingDeepSpaceTransformer(pf, miniMap))
      .wrap((pf) => new SectorBoundaryCoercingTransformer(pf, miniMap))
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static WaterSimple(game: Game): SteppingPathFinder<TileRef> {
    const miniMap = game.miniMap();
    const pf = new AStarDeepSpace(miniMap);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new SectorBoundaryCoercingTransformer(pf, miniMap))
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static Rail(game: Game): SteppingPathFinder<TileRef> {
    const miniMap = game.miniMap();
    const pf = new AStarHyperspaceLane(miniMap);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static Stations(game: Game): SteppingPathFinder<TradeHub> {
    const pf = new StationPathFinder(game);

    return PathFinderBuilder.create(pf).buildWithStepper({
      equals: (a, b) => a.id === b.id,
      distance: (a, b) => game.manhattanDist(a.tile(), b.tile()),
    });
  }

  static Air(game: Game): SteppingPathFinder<TileRef> {
    const pf = new AirPathFinder(game);

    return PathFinderBuilder.create(pf).buildWithStepper({
      equals: (a, b) => a === b,
    });
  }
}

function tileStepperConfig(game: Game): StepperConfig<TileRef> {
  return {
    equals: (a, b) => a === b,
    distance: (a, b) => game.manhattanDist(a, b),
    preCheck: (from, to) =>
      typeof from !== "number" ||
      typeof to !== "number" ||
      !game.isValidRef(from) ||
      !game.isValidRef(to)
        ? { status: PathStatus.NOT_FOUND }
        : null,
  };
}
