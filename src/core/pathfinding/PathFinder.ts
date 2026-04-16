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
import { PathResult, PathStatus, SteppingPathFinder } from "./types";

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
  static DeepSpace(game: Game): SteppingPathFinder<TileRef> {
    // Runtime void→sector promotions (scout-swarm terraforming, capital
    // ship anchors) mutate the minimap terrain buffer but leave the HPA
    // graph stale. Return a wrapper that re-evaluates the dirty flag on
    // every query so long-lived steppers (cached in Execution.init) can
    // observe mid-lifecycle promotions and route via `DeepSpaceSimple`
    // instead of the stale HPA cache. When the wrapper observes the
    // dirty flag it consumes it (via `clearDeepSpaceGraphDirty`) and
    // latches simple routing for the current tick so subsequent queries
    // within the same tick stay on the fallback without flapping; a
    // future tick re-evaluates dirty state from scratch.
    return new DeepSpaceRuntimeSwitchingPathFinder(game);
  }

  static DeepSpaceSimple(game: Game): SteppingPathFinder<TileRef> {
    const miniMap = game.miniMap();
    const pf = new AStarDeepSpace(miniMap);

    return PathFinderBuilder.create(pf)
      .wrap((pf) => new SectorBoundaryCoercingTransformer(pf, miniMap))
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static DeepSpaceHPA(game: Game): SteppingPathFinder<TileRef> | null {
    const pf = game.miniDeepSpaceHPA();
    const graph = game.miniDeepSpaceGraph();

    if (!pf || !graph || graph.nodeCount < 100) {
      return null;
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

  static Vacuum(game: Game): SteppingPathFinder<TileRef> {
    const pf = new AirPathFinder(game);

    return PathFinderBuilder.create(pf).buildWithStepper({
      equals: (a, b) => a === b,
    });
  }
}

/**
 * Wraps deep-space routing so the choice between HPA and simple A* is
 * re-evaluated on every query, not frozen at construction time. This lets
 * long-lived steppers (cached in Execution.init) correctly fall back to
 * `DeepSpaceSimple` when the HPA graph becomes stale due to void→sector
 * promotion, and swap back if/when the HPA graph is refreshed.
 */
class DeepSpaceRuntimeSwitchingPathFinder
  implements SteppingPathFinder<TileRef>
{
  private hpa: SteppingPathFinder<TileRef> | null = null;
  private simple: SteppingPathFinder<TileRef> | null = null;
  private lastUsedSimple: boolean | null = null;
  // Tick at which simple-routing was last latched. While this matches
  // the current game tick, `shouldUseSimple` short-circuits to true so
  // repeated queries inside one tick stay on the fallback even after
  // the dirty flag has been consumed.
  private latchedSimpleTick: number | null = null;

  constructor(private game: Game) {}

  private shouldUseSimple(): boolean {
    const currentTick = this.game.ticks();

    if (this.game.isDeepSpaceGraphDirty()) {
      // Consume the dirty flag on first observation and latch simple
      // routing for this tick. Future ticks re-evaluate cleanly.
      this.game.clearDeepSpaceGraphDirty();
      this.latchedSimpleTick = currentTick;
      return true;
    }

    if (this.latchedSimpleTick === currentTick) return true;

    const pf = this.game.miniDeepSpaceHPA();
    const graph = this.game.miniDeepSpaceGraph();
    return !pf || !graph || graph.nodeCount < 100;
  }

  private getActive(): SteppingPathFinder<TileRef> {
    const useSimple = this.shouldUseSimple();
    if (this.lastUsedSimple !== null && useSimple !== this.lastUsedSimple) {
      // Invalidate both cached steppers on swap so a stale cached path from
      // the prior finder does not leak into the new one.
      this.simple?.invalidate();
      this.hpa?.invalidate();
    }
    this.lastUsedSimple = useSimple;

    if (useSimple) {
      this.simple ??= PathFinding.DeepSpaceSimple(this.game);
      return this.simple;
    }

    this.hpa ??=
      PathFinding.DeepSpaceHPA(this.game) ??
      PathFinding.DeepSpaceSimple(this.game);
    return this.hpa;
  }

  next(from: TileRef, to: TileRef, dist?: number): PathResult<TileRef> {
    return this.getActive().next(from, to, dist);
  }

  invalidate(): void {
    this.simple?.invalidate();
    this.hpa?.invalidate();
  }

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    return this.getActive().findPath(from, to);
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
