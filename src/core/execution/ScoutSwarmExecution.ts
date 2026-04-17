import {
  Execution,
  Game,
  MessageType,
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
      mg.displayMessage(
        "events_display.scout_swarm_failed",
        MessageType.SCOUT_SWARM_FAILED,
        this.launcher.id(),
        undefined,
        { reason: "Invalid target tile" },
      );
      this.active = false;
      return;
    }

    // Scout swarms launch from the launcher's nearest Spaceport or Jump
    // Gate to the target. Resolve the spawn tile *before* charging cost
    // so a player with no launch infrastructure isn't silently taxed for
    // a launch that never happens.
    const spawnTile = this.findSpawnTile();
    if (spawnTile === null) {
      // Before this surfaced a user-visible reason, the scout-swarm
      // intent silently no-op'd when the launcher had no Spaceport /
      // Jump Gate — the player saw their credits-or-population tick
      // *not* deduct (we return before charging) and no swarm appear,
      // with no explanation. Emit a visible event so the user knows
      // why the launch failed and how to fix it.
      mg.displayMessage(
        "events_display.scout_swarm_failed",
        MessageType.SCOUT_SWARM_FAILED,
        this.launcher.id(),
        undefined,
        { reason: "Build a Spaceport or Jump Gate to launch Scout Swarms" },
      );
      this.active = false;
      return;
    }

    // Launch cost is a percentage of the player's *current* credits (GDD §4).
    // Snapshot it now so the deducted amount can't drift if the player
    // spends between the intent being submitted and this tick.
    //
    // We use deterministic bigint-only arithmetic here: converting the
    // credit balance via `Number(credits)` loses precision once the player
    // grows beyond `Number.MAX_SAFE_INTEGER`, which would quietly under- or
    // overcharge launches and violate the 10% cost contract for the bigint
    // economy. Instead, rasterize the fractional multiplier to a fixed-
    // precision rational (numerator / denominator) and apply it entirely in
    // bigint space. Integer division floors toward zero, which matches the
    // previous `Math.floor` rounding behavior.
    const credits = this.launcher.credits();
    const fraction = mg.config().scoutSwarmCostFraction();
    const FRACTION_SCALE = 1_000_000n;
    const scaledNumerator = BigInt(
      Math.round(fraction * Number(FRACTION_SCALE)),
    );
    const cost = (credits * scaledNumerator) / FRACTION_SCALE;
    if (cost > 0n) {
      this.launcher.removeCredits(cost);
    }

    // GDD §3.1 — scouting/terraforming also consumes population. The cost
    // is a fixed configurable amount, not derived from the launcher's
    // population cap, so the tax stays predictable regardless of empire
    // size. Soft cost: `removePopulation` deducts up to the available
    // balance, so a launcher with insufficient current population still
    // launches successfully.
    const populationCost = mg.config().scoutSwarmPopulationCost();
    if (populationCost > 0) {
      this.launcher.removePopulation(populationCost);
    }

    this.scout = this.launcher.buildUnit(UnitType.ScoutSwarm, spawnTile, {
      targetTile: this.target,
    });
    this.scout.setTargetTile(this.target);
  }

  /**
   * Scout swarms require a Spaceport or Jump Gate to launch from. Returns
   * the tile of the player's launch structure closest to the target, or
   * `null` if the player owns none.
   */
  private findSpawnTile(): TileRef | null {
    const structures = [
      ...this.launcher.units(UnitType.Spaceport),
      ...this.launcher.units(UnitType.JumpGate),
    ];
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const unit of structures) {
      if (!unit.isActive()) continue;
      const t = unit.tile();
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
      // GDD §4 — scouts lay a 1-tile-wide trail, converting deep-space
      // tiles they fly through into AsteroidField (and repeated passes
      // step established corridors further toward habitability). Shares
      // the same per-tile accumulation counter as destination
      // terraforming, so multiple scouts on the same path accumulate
      // progress. The final destination step is handled exclusively by
      // onArrival() to avoid double-counting the target tile in the
      // same tick.
      const arrivingAtTarget = next === this.target;
      if (!arrivingAtTarget) {
        this.tryTerraformTrailTile(next);
      }
      this.scout.move(next);
      if (arrivingAtTarget) {
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
    // GDD §4 — terraform a cluster of deep-space tiles around the
    // arrival target. circleSearch visits every tile within the
    // configured Euclidean radius; we bump the shared counter only for
    // DeepSpace tiles so clusters expand the sector boundary without
    // re-stepping already-sector tiles that should only progress via
    // direct arrival or the trail.
    const clusterRadius = this.mg.config().scoutSwarmClusterRadius();
    if (clusterRadius > 0) {
      const tiles = this.mg.circleSearch(tile, clusterRadius);
      for (const t of tiles) {
        if (t === tile) continue;
        if (this.mg.map().terrainType(t) !== TerrainType.DeepSpace) continue;
        const p = this.mg.recordScoutSwarmTerraformProgress(t);
        if (p >= threshold) {
          this.applyTerraformStep(t);
          this.mg.resetScoutSwarmTerraformProgress(t);
        }
      }
    }
    // Swarms are temporary — dissolve on arrival regardless of whether
    // this particular scout tripped the threshold.
    this.scout.delete(false);
    this.active = false;
  }

  /**
   * Bump the shared per-tile terraform counter for `tile` if it is
   * currently on a terraformable band (DeepSpace, AsteroidField, or
   * Nebula) and step the terrain one band if the accumulation threshold
   * is reached. Used by the flight-path trail — onArrival handles the
   * destination tile itself. OpenSpace and DebrisField are skipped so
   * fully-habitable/unsteppable terrain is never counted.
   */
  private tryTerraformTrailTile(tile: TileRef): void {
    const terrain = this.mg.map().terrainType(tile);
    if (
      terrain !== TerrainType.DeepSpace &&
      terrain !== TerrainType.AsteroidField &&
      terrain !== TerrainType.Nebula
    ) {
      return;
    }
    const threshold = this.mg.config().scoutSwarmTerraformAccumulation();
    const progress = this.mg.recordScoutSwarmTerraformProgress(tile);
    if (progress >= threshold) {
      this.applyTerraformStep(tile);
      this.mg.resetScoutSwarmTerraformProgress(tile);
    }
  }

  /**
   * Steps the terrain at `tile` one level toward habitability and keeps
   * the SectorMap's per-player habitability sum in sync if the tile is
   * owned. The magnitude changes happen inside GameMap.setTerrainType;
   * here we just translate the current TerrainType to its next stage.
   *
   * The actual mutation is routed through `Game.setTerrainType` (not
   * `GameMap.setTerrainType`) so the change is recorded on the server's
   * per-tick terrain update channel and synchronized to clients.
   *
   * GDD §4 "Controlled once partially habitable": if the tile was
   * unowned (TerraNullius) before the terraform step, the launching
   * player now takes ownership. This completes the GDD's explore →
   * terraform → control loop. Ownership is only granted on unowned
   * tiles — capturing enemy territory still requires combat.
   */
  private applyTerraformStep(tile: TileRef): void {
    const map = this.mg.map();
    const current = map.terrainType(tile);
    let next: TerrainType;
    switch (current) {
      case TerrainType.DeepSpace:
        // GDD §4 extension — scouts can stake out the first foothold in
        // previously-impassable void by converting it into an AsteroidField
        // tile. The sector/void boundary physically shifts: GameMap and
        // SectorMap track the promotion, and the launcher (below) takes
        // ownership the same way the asteroid→nebula step does.
        next = TerrainType.AsteroidField;
        break;
      case TerrainType.AsteroidField:
        next = TerrainType.Nebula;
        break;
      case TerrainType.Nebula:
        next = TerrainType.OpenSpace;
        break;
      default:
        // OpenSpace / DebrisField — nothing to do.
        return;
    }

    const sectorMap = this.mg.sectorMap();
    const ownerIdBefore = map.hasOwner(tile) ? map.ownerID(tile) : null;
    const previousHab =
      ownerIdBefore !== null ? sectorMap.effectiveHabitability(tile) : 0;

    this.mg.setTerrainType(tile, next);

    // Keep the per-player habitability sum in sync if someone owns the
    // tile. Scouts normally target unowned territory, but nothing stops
    // a player from terraforming a captured asteroid field to a nebula,
    // so we handle the owned case gracefully.
    if (ownerIdBefore !== null) {
      sectorMap.recomputeHabitabilityForTile(tile, ownerIdBefore, previousHab);
      return;
    }

    // Tile was unowned before the terraform — grant ownership to the
    // launcher. Gated on isAlive() because conquer() adds a tile to the
    // player, and PlayerImpl.isAlive() is defined as `_tiles.size > 0`.
    // If the launcher was eliminated while the scout was travelling,
    // conquering here would revive them with one tile and break the
    // elimination / permadeath contract. conquer() runs *after*
    // setTerrainType so the recordTileGained inside it picks up the
    // new terrain's habitability, not the old one.
    if (this.launcher.isAlive()) {
      this.launcher.conquer(tile);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
