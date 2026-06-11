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
  /**
   * Capital-ship pathfinder. Identical to {@link DeepSpaceSimple} (no
   * HPA cache) except that sector tiles owned by the cruiser's owner are
   * treated as passable in addition to deep-space tiles, so the cruiser
   * can re-traverse the wake of AsteroidField sector tiles its
   * `claimTerritoryRadius` lays down.
   *
   * Uses the same 2× minimap as `DeepSpaceSimple` so path resolution
   * matches the existing deep-space behavior — the cruiser doesn't
   * suddenly take a different route in deep space just because it now
   * has owner-aware passability. Ownership is read from the minimap's
   * `state` buffer, which `GameImpl.conquer` / `relinquish` mirror from
   * the main map on every flip.
   *
   * `ownerSmallIDGetter` is a getter (not a fixed value) so that
   * `captureUnit` flipping the cruiser's owner mid-run gets picked up by
   * the next path query without rebuilding the pathfinder.
   */
  static CapitalShip(
    game: Game,
    ownerSmallIDGetter: () => number,
  ): SteppingPathFinder<TileRef> {
    const miniMap = game.miniMap();
    const pf = new AStarDeepSpace(miniMap, {
      passableOwnerSmallID: ownerSmallIDGetter,
    });

    // Intentionally NO `SectorBoundaryCoercingTransformer`: the cruiser
    // routinely starts a tick on its own wake (a sector tile owned by
    // its owner), and that transformer would coerce the start back to
    // the nearest deep-space neighbor before handing the query to the
    // inner finder — defeating the owner-aware passability check below.
    // `MoveBattlecruiserExecution.findNearestVoid` already clamps the
    // destination to a void tile up-front, and `randomTile()` returns
    // void tiles, so the goal end of the path is always deep space and
    // does not need coercion either.
    return PathFinderBuilder.create(pf)
      .wrap((pf) => new MiniMapTransformer(pf, game.map(), miniMap))
      .buildWithStepper(tileStepperConfig(game));
  }

  static DeepSpace(game: Game): SteppingPathFinder<TileRef> {
    // Runtime void→sector promotions (scout-swarm terraforming, capital
    // ship anchors) mutate the minimap terrain buffer but leave the HPA
    // graph stale. Return a wrapper that re-evaluates staleness on
    // every query so long-lived steppers (cached in Execution.init) can
    // observe mid-lifecycle promotions and route via `DeepSpaceSimple`
    // instead of the stale HPA cache. The game-global dirty flag is
    // consume-on-read (via `clearDeepSpaceGraphDirty`), so the wrapper
    // that observes it records the staleness in a shared per-game
    // version counter that every other wrapper instance — and every
    // future tick — checks; the HPA graph is built once at game init
    // and never rebuilt, so once stale it stays stale.
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
 * Monotonic per-game staleness version for the deep-space HPA graph.
 * `isDeepSpaceGraphDirty` is consume-on-read and there is one switcher
 * instance per in-flight unit, so the first instance to observe the
 * flag must translate it into a signal every other instance (and every
 * later tick) can still see. The HPA graph is built once in the
 * GameImpl constructor (version 0) and never rebuilt, so any version
 * above zero means the graph is permanently stale and all instances
 * must route via the simple fallback. Keyed weakly by Game so state
 * never leaks between simultaneous games or between tests.
 */
const deepSpaceStaleVersion = new WeakMap<Game, number>();

/**
 * Wraps deep-space routing so the choice between HPA and simple A* is
 * re-evaluated on every query, not frozen at construction time. This lets
 * long-lived steppers (cached in Execution.init) correctly fall back to
 * `DeepSpaceSimple` when the HPA graph becomes stale due to void→sector
 * promotion. Staleness is tracked in the shared per-game version counter
 * above so all wrapper instances switch consistently, regardless of which
 * one consumed the dirty flag.
 */
class DeepSpaceRuntimeSwitchingPathFinder
  implements SteppingPathFinder<TileRef>
{
  private hpa: SteppingPathFinder<TileRef> | null = null;
  private simple: SteppingPathFinder<TileRef> | null = null;
  private lastUsedSimple: boolean | null = null;
  // Version of the HPA graph this wrapper trusts. Always 0 today (the
  // graph is built once at game init and never rebuilt); if a rebuild
  // mechanism is ever added, refresh this alongside `this.hpa` when
  // re-acquiring the rebuilt graph.
  private readonly hpaGraphVersion: number = 0;

  constructor(private game: Game) {}

  private shouldUseSimple(): boolean {
    if (this.game.isDeepSpaceGraphDirty()) {
      // Consume the single-shot dirty flag and record the staleness in
      // the shared per-game version so ALL wrapper instances — not just
      // the first one to query after a promotion — keep routing via the
      // fallback on this and every future tick.
      this.game.clearDeepSpaceGraphDirty();
      deepSpaceStaleVersion.set(
        this.game,
        (deepSpaceStaleVersion.get(this.game) ?? 0) + 1,
      );
    }

    if ((deepSpaceStaleVersion.get(this.game) ?? 0) > this.hpaGraphVersion) {
      return true;
    }

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
