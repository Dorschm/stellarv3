import {
  Execution,
  Game,
  Player,
  TerrainType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Scout Swarm execution — GDD §4, §6 and Ticket 6 (Fleet Systems).
 *
 * A Scout Swarm is a **temporary** unit. On launch it:
 *   1. Deducts `scoutSwarmCostFraction()` of the player's current credits.
 *   2. Spawns at the closest owned sector tile to the target.
 *   3. Travels toward the target at `scoutSwarmTilesPerTick()` tiles/tick,
 *      which is derived from the GDD's "2 AU/min" figure via
 *      `auInTiles()` and the 10 ticks/sec rate.
 *
 * On arrival at the target tile (or when the accumulated "swarm size"
 * on the target reaches `scoutSwarmTerraformAccumulation()`), the terrain
 * class of the target tile is stepped one band toward habitability:
 *   AsteroidField → Nebula → OpenSpace
 * OpenSpace tiles cannot be terraformed further (already ideal) — the
 * swarm still dissolves on arrival but is a no-op on the terrain.
 *
 * Swarms are dissolved automatically after {@link scoutSwarmLifetimeTicks}
 * so stranded swarms (unreachable target, dead owner, etc.) never hang
 * around forever.
 *
 * Note on "swarm accumulation": the GDD phrases accumulation in terms of
 * swarm size per km², which has no direct mapping in a tile grid. We
 * approximate it by counting scout *arrivals* at the target tile — a
 * shared counter lives on `Game` via {@link Game.scoutSwarmTerraformProgress}.
 * When the counter for a given tile crosses the configured threshold, the
 * terrain is stepped and the counter is reset.
 */
export class ScoutSwarmExecution implements Execution {
  private active = true;
  private mg: Game;
  private scout: Unit | null = null;
  private readonly target: TileRef;
  private ticksAlive = 0;
  // Fractional tile accumulator — scoutSwarmTilesPerTick() is less than 1
  // at the default AU_IN_TILES=100 (1/3 tile/tick), so we accumulate across
  // ticks instead of teleporting.
  private progressAccumulator = 0;

  constructor(
    private readonly launcher: Player,
    target: TileRef,
  ) {
    this.target = target;
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;

    if (!mg.isValidRef(this.target)) {
      console.warn(`ScoutSwarmExecution: invalid target tile ${this.target}`);
      this.active = false;
      return;
    }

    // Launch cost is a percentage of the player's *current* credits (GDD §4).
    // Snapshot it now so the deducted amount can't drift if the player
    // spends between the intent being submitted and this tick.
    const credits = this.launcher.credits();
    const fraction = mg.config().scoutSwarmCostFraction();
    const cost = BigInt(Math.floor(Number(credits) * fraction));
    if (cost > 0n) {
      this.launcher.removeCredits(cost);
    }

    // Find a spawn tile: the launcher's owned tile closest to the target.
    // Scouts launch from anywhere the player owns — there's no spaceport
    // requirement, so the launch point is purely a path anchor.
    const spawnTile = this.findSpawnTile();
    if (spawnTile === null) {
      console.warn(
        `ScoutSwarmExecution: ${this.launcher.displayName()} has no owned tiles to launch from`,
      );
      this.active = false;
      return;
    }

    this.scout = this.launcher.buildUnit(UnitType.ScoutSwarm, spawnTile, {
      targetTile: this.target,
    });
    this.scout.setTargetTile(this.target);
  }

  private findSpawnTile(): TileRef | null {
    const tiles = this.launcher.tiles();
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const t of tiles) {
      const d = this.mg.manhattanDist(t, this.target);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  tick(_ticks: number): void {
    if (!this.active || this.scout === null) {
      return;
    }
    if (!this.scout.isActive()) {
      this.active = false;
      return;
    }

    this.ticksAlive++;

    // Lifetime cap — dissolve stranded swarms rather than leaking them.
    if (this.ticksAlive > this.mg.config().scoutSwarmLifetimeTicks()) {
      this.scout.delete(false);
      this.active = false;
      return;
    }

    const current = this.scout.tile();
    if (current === this.target) {
      this.onArrival(this.target);
      return;
    }

    // Fractional-tile stepping. With AU_IN_TILES=100 and 2 AU/min the
    // base speed is ~0.333 tiles/tick, so we only step when the
    // accumulator crosses 1.0.
    this.progressAccumulator += this.mg.config().scoutSwarmTilesPerTick();
    while (this.progressAccumulator >= 1 && this.scout.isActive()) {
      this.progressAccumulator -= 1;
      const next = this.nextTileTowardTarget(this.scout.tile());
      if (next === null) {
        // No legal step — bail out and let the lifetime cap dissolve us.
        this.active = false;
        this.scout.delete(false);
        return;
      }
      this.scout.move(next);
      if (next === this.target) {
        this.onArrival(this.target);
        return;
      }
    }
  }

  /**
   * Simple greedy-step pathing toward the target. Scout swarms traverse
   * deep space freely and do not run the grid pathfinder — their purpose
   * is exploration, not combat, and GDD §4 calls them "free-moving".
   *
   * The chosen neighbor is the one that minimizes manhattan distance to
   * the target. Ties are broken by the neighbor iteration order, which is
   * deterministic (N/S/E/W in `GameMapImpl.neighbors`).
   */
  private nextTileTowardTarget(from: TileRef): TileRef | null {
    const neighbors = this.mg.neighbors(from);
    let best: TileRef | null = null;
    let bestDist = this.mg.manhattanDist(from, this.target);
    for (const n of neighbors) {
      const d = this.mg.manhattanDist(n, this.target);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  private onArrival(tile: TileRef): void {
    if (this.scout === null) return;
    // Bump the shared per-tile terraform progress. If the threshold is
    // reached, step the terrain one band and reset the counter.
    const threshold = this.mg.config().scoutSwarmTerraformAccumulation();
    const progress = this.mg.recordScoutSwarmTerraformProgress(tile);
    if (progress >= threshold) {
      this.applyTerraformStep(tile);
      this.mg.resetScoutSwarmTerraformProgress(tile);
    }
    // Swarms are temporary — dissolve on arrival regardless of whether
    // this particular scout tripped the threshold.
    this.scout.delete(false);
    this.active = false;
  }

  /**
   * Steps the terrain at `tile` one level toward habitability and keeps
   * the SectorMap's per-player habitability sum in sync if the tile is
   * owned. The magnitude changes happen inside GameMap.setTerrainType;
   * here we just translate the current TerrainType to its next stage.
   */
  private applyTerraformStep(tile: TileRef): void {
    const map = this.mg.map();
    const current = map.terrainType(tile);
    let next: TerrainType;
    switch (current) {
      case TerrainType.AsteroidField:
        next = TerrainType.Nebula;
        break;
      case TerrainType.Nebula:
        next = TerrainType.OpenSpace;
        break;
      default:
        // OpenSpace / DeepSpace / DebrisField — nothing to do.
        return;
    }

    const sectorMap = this.mg.sectorMap();
    const ownerIdBefore = map.hasOwner(tile) ? map.ownerID(tile) : null;
    const previousHab =
      ownerIdBefore !== null ? sectorMap.effectiveHabitability(tile) : 0;

    map.setTerrainType(tile, next);

    // Keep the per-player habitability sum in sync if someone owns the
    // tile. Scouts normally target unowned territory, but nothing stops
    // a player from terraforming a captured asteroid field to a nebula,
    // so we handle the owned case gracefully.
    if (ownerIdBefore !== null) {
      sectorMap.recomputeHabitabilityForTile(tile, ownerIdBefore, previousHab);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
