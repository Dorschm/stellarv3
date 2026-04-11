import { PseudoRandom } from "../PseudoRandom";
import { Player, TerrainType } from "./Game";
import { GameMap, TileRef } from "./GameMap";
import type { PlayerView } from "./GameView";

/**
 * Habitability constants — see GDD Economy Alignment Approach §3.
 *
 * These map raw {@link TerrainType} values onto a 0..1 habitability score
 * used by the (forthcoming) economy formulas. They are intentionally exposed
 * as constants so balance can be tuned in one place.
 */
export const HABITABILITY_OPEN_SPACE = 1.0;
export const HABITABILITY_NEBULA = 0.6;
export const HABITABILITY_ASTEROID = 0.3;

/**
 * Maps a {@link TerrainType} onto a 0..1 habitability score.
 *
 * Non-sector terrain types ({@link TerrainType.DebrisField} and
 * {@link TerrainType.DeepSpace}) return 0.0. These tiles are never owned by
 * a player, so the value is never read in practice — but we still return a
 * defined number to avoid `undefined` poisoning any caller that maps over
 * arbitrary tiles.
 */
export function habitabilityForTerrain(type: TerrainType): number {
  switch (type) {
    case TerrainType.OpenSpace:
      return HABITABILITY_OPEN_SPACE;
    case TerrainType.Nebula:
      return HABITABILITY_NEBULA;
    case TerrainType.AsteroidField:
      return HABITABILITY_ASTEROID;
    case TerrainType.DebrisField:
    case TerrainType.DeepSpace:
      return 0.0;
    default:
      return 0.0;
  }
}

/**
 * A seed coordinate used to anchor a sector. The {@link SectorMap}
 * floods outward from each seed across {@link GameMap.isSector} tiles to
 * determine which tiles belong to which sector.
 */
export interface SectorSeed {
  x: number;
  y: number;
}

/**
 * Maximum number of sectors representable in the parallel `Uint8Array`.
 * Sector ID 0 is reserved for "no sector", so the max sector index is 255.
 */
const MAX_SECTOR_ID = 255;

/**
 * GDD §9 — per-planet random resource modifier range. A lucky planet
 * produces 4× the credit volume bonus of an unlucky one (2.0 / 0.5),
 * while the flat trickle in `creditAdditionRate()` is unaffected so no
 * player ever earns zero credits regardless of modifier.
 */
export const SECTOR_RESOURCE_MODIFIER_MIN = 0.5;
export const SECTOR_RESOURCE_MODIFIER_MAX = 2.0;

/**
 * Prime multiplier used to seed the per-sector `PseudoRandom` from the
 * sector ID. Chosen so sequential sector IDs (1, 2, 3 …) produce
 * well-spread seeds instead of clustering in the low end of the RNG state
 * space. Must stay constant across server and clients for the modifier
 * to remain deterministic.
 */
const SECTOR_RESOURCE_SEED_MULTIPLIER = 7919;

/**
 * `SectorMap` partitions the `GameMap`'s sector tiles into per-nation
 * sectors via a BFS flood from each nation's seed coordinate.
 *
 * Built once at game init from the map binary + manifest nations. Stores
 * sector assignments in a `Uint8Array` parallel to the tile grid (one byte
 * per tile). Tile sector ID `0` means "not in any sector" — either the tile
 * is non-sector terrain, or no BFS flood reached it.
 *
 * See GDD Economy Alignment Approach §3 — Component Architecture.
 */
export class SectorMap {
  /** Sector ID per tile, parallel to the GameMap tile grid. 0 = none. */
  private readonly sectorIds: Uint8Array;
  /** Per-sector tile counts. Index 0 unused; indices 1..N are valid. */
  private readonly perSectorTileCount: number[];
  /**
   * Per-sector GDD §9 random resource modifier in `[0.5, 2.0)`. Index 0
   * unused; indices 1..N mirror {@link perSectorTileCount}. Generated
   * deterministically from the sector ID via {@link PseudoRandom} so
   * every peer (server + clients) agrees on the same value for a given
   * sector without any network sync.
   *
   * Feeds into {@link playerWeightedYieldTiles} (and therefore
   * `creditAdditionRate` in DefaultConfig) — planets of identical size
   * and habitability produce different credit rates depending on the
   * luck of this roll.
   */
  private readonly perSectorResourceModifier: number[];
  /**
   * The map this SectorMap was built from. Stored so the per-player query
   * methods can resolve `terrainType()` without callers having to thread the
   * `GameMap` through every economy formula. See GDD Economy Alignment
   * Approach §3 — "SectorMap stores its GameMap reference internally".
   */
  private readonly gameMap: GameMap;
  /**
   * Running per-player count of owned tiles that lie inside any sector.
   * Indexed by `player.smallID()`. Maintained incrementally via
   * {@link recordTileGained} / {@link recordTileLost}, driven from
   * GameImpl.conquer/relinquish.
   *
   * Before these hooks existed, `playerOwnedSectorTiles` iterated the
   * entire player tile set on every call — and was called twice per player
   * per tick by the economy formulas, dominating tick cost (see perf
   * baseline). The running total turns both queries into O(1).
   */
  private readonly perPlayerSectorTileCount: number[] = [];
  /**
   * Running per-player sum of habitability scores across owned sector
   * tiles. Divided by {@link perPlayerSectorTileCount} at query time to
   * produce the average. See {@link recordTileGained}.
   */
  private readonly perPlayerHabitabilitySum: number[] = [];
  /**
   * Per-player count of owned sector tiles bucketed by their *effective*
   * habitability — full (>= ~1.0, OpenSpace), partial (~0.6, Nebula),
   * uninhabitable (~0.3, AsteroidField). Maintained alongside the
   * habitability sum so the GDD §3 economy formulas can read O(1) bucket
   * counts (`maxPopulation = 100 * full + 25 * partial`,
   * `troopGrowth = +3%/s on full only`,
   * `creditGen = +1 per (full + partial) per tick`).
   *
   * Tracked by *effective* habitability (not base terrain) so a Long-Range
   * Weapon damage hit that drops a tile from full → partial is correctly
   * reflected in the buckets via {@link applyHabitabilityDamage} and
   * {@link recomputeHabitabilityForTile}.
   */
  private readonly perPlayerFullHabTileCount: number[] = [];
  private readonly perPlayerPartialHabTileCount: number[] = [];
  private readonly perPlayerUninhabTileCount: number[] = [];
  /**
   * Running per-player sum of `(fullTiles + partialTiles) × sectorModifier`
   * across the player's owned sector tiles, keyed by `smallID()`. Drives the
   * GDD §9 random-resource bonus in `creditAdditionRate()` without forcing
   * the hot-path credit formula to re-walk the player's tile set each tick.
   *
   * Only *yielding* tiles (full or partial habitability buckets)
   * contribute — uninhabitable tiles are excluded because
   * `creditAdditionRate()` already treats them as zero yield. The sum is
   * maintained by the same four mutation points that manage
   * {@link perPlayerHabitabilitySum}:
   *   - {@link recordTileGained}     — add modifier when a yielding tile is gained
   *   - {@link recordTileLost}       — subtract modifier when a yielding tile is lost
   *   - {@link applyHabitabilityDamage} — swap on bucket transitions after LRW damage
   *   - {@link recomputeHabitabilityForTile} — swap on bucket transitions after terraforming
   *
   * Kept as a SEPARATE running total from `perPlayerHabitabilitySum` so
   * population formulas (`maxTroops`, `troopIncreaseRate`) remain
   * unweighted by the random modifier; only credit generation is affected.
   */
  private readonly perPlayerWeightedYieldSum: number[] = [];
  /**
   * Sparse per-tile habitability damage overlay. Indexed by `TileRef`
   * (the same flat tile index used by `sectorIds`). Values represent the
   * cumulative habitability *reduction* (0..1) inflicted on a tile by
   * Long-Range Weapon strikes (see Ticket 5: Structure Alignment). The
   * effective per-tile habitability is then
   *   `max(0, baseHab - habitabilityDamage[tile])`.
   *
   * Stored as a sparse `Map` because LRW hits are rare relative to the
   * tile count — instantiating a Float32Array sized to the whole map
   * would waste megabytes when only a handful of tiles are ever damaged.
   * Maintained alongside {@link perPlayerHabitabilitySum} so subsequent
   * conquer/relinquish events on a damaged tile contribute the correctly
   * reduced score to the running totals.
   */
  private readonly habitabilityDamage: Map<TileRef, number> = new Map();

  constructor(
    gameMap: GameMap,
    seeds: ReadonlyArray<SectorSeed | undefined | null>,
  ) {
    this.gameMap = gameMap;
    const w = gameMap.width();
    const h = gameMap.height();
    this.sectorIds = new Uint8Array(w * h);
    // Index 0 = "no sector"; per-sector counts start at index 1.
    this.perSectorTileCount = [0];
    this.perSectorResourceModifier = [0];

    let nextSectorId = 1;
    for (const seed of seeds) {
      if (!seed) continue;
      if (!gameMap.isValidCoord(seed.x, seed.y)) continue;

      const seedRef = gameMap.ref(seed.x, seed.y);
      if (!gameMap.isSector(seedRef)) continue;
      if (this.sectorIds[seedRef] !== 0) continue;

      if (nextSectorId > MAX_SECTOR_ID) {
        console.warn(
          `[SectorMap] Hit max sector capacity (${MAX_SECTOR_ID}); ` +
            `remaining seeds will be ignored`,
        );
        break;
      }

      const sectorId = nextSectorId++;
      const count = this.floodFill(gameMap, seedRef, sectorId);
      this.perSectorTileCount.push(count);
      // GDD §9 — roll a deterministic per-sector resource modifier from
      // the sector ID. PseudoRandom is seeded solely from the sector ID
      // (× a prime for spread) so server and all clients produce the
      // same modifier without any sync, and replays are bit-exact.
      const rng = new PseudoRandom(sectorId * SECTOR_RESOURCE_SEED_MULTIPLIER);
      this.perSectorResourceModifier.push(
        rng.nextFloat(
          SECTOR_RESOURCE_MODIFIER_MIN,
          SECTOR_RESOURCE_MODIFIER_MAX,
        ),
      );
    }
  }

  /**
   * Iterative BFS flood from `start` across `isSector()` tiles, assigning
   * `sectorId` to every reached tile. Returns the number of tiles painted.
   */
  private floodFill(
    gameMap: GameMap,
    start: TileRef,
    sectorId: number,
  ): number {
    let count = 0;
    const queue: TileRef[] = [start];
    this.sectorIds[start] = sectorId;
    while (queue.length > 0) {
      const curr = queue.pop() as TileRef;
      count++;
      const neighbors = gameMap.neighbors(curr);
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (this.sectorIds[n] !== 0) continue;
        if (!gameMap.isSector(n)) continue;
        this.sectorIds[n] = sectorId;
        queue.push(n);
      }
    }
    return count;
  }

  /**
   * O(1) sector lookup for a single tile. Returns `0` if the tile is not in
   * any sector (non-sector terrain or unreached by any BFS).
   */
  sectorOf(tile: TileRef): number {
    return this.sectorIds[tile];
  }

  /**
   * Total tile count of a sector. Returns `0` for `sectorId === 0` and for
   * any out-of-range sector ID.
   */
  sectorTileCount(sectorId: number): number {
    if (sectorId <= 0 || sectorId >= this.perSectorTileCount.length) {
      return 0;
    }
    return this.perSectorTileCount[sectorId];
  }

  /** Number of distinct sectors detected (excludes the implicit `0`). */
  numSectors(): number {
    return this.perSectorTileCount.length - 1;
  }

  /**
   * GDD §9 per-sector random resource modifier in `[0.5, 2.0)`.
   * Deterministic across server and all clients: same sector ID always
   * produces the same modifier because it is seeded from the sector ID
   * itself at construction time. Returns `1.0` (the no-op identity for
   * the volume bonus) for `sectorId === 0` and any out-of-range sector,
   * so callers that look up "no sector" tiles via {@link sectorOf} get a
   * harmless pass-through instead of a spurious penalty or bonus.
   */
  sectorResourceModifier(sectorId: number): number {
    if (sectorId <= 0 || sectorId >= this.perSectorResourceModifier.length) {
      return 1.0;
    }
    return this.perSectorResourceModifier[sectorId];
  }

  /**
   * O(1) count of the player's owned tiles that lie inside any sector.
   *
   * Reads from a running total maintained by
   * {@link recordTileGained} / {@link recordTileLost}, which are driven
   * from GameImpl.conquer/relinquish on the server and from
   * GameView.update's packed tile diff on the client. See the field doc
   * on {@link perPlayerSectorTileCount} for context.
   *
   * Accepts both server-side `Player` and client-side `PlayerView` —
   * both expose a stable `smallID()`, and the client mirrors ownership
   * changes into the same per-player counters so HUD consumers
   * (ControlPanel, Leaderboard) see the authoritative value rather than
   * a forced fallback.
   */
  playerOwnedSectorTiles(player: Player | PlayerView): number {
    const id = player.smallID();
    return this.perPlayerSectorTileCount[id] ?? 0;
  }

  /**
   * Bucket an effective habitability score into one of the three GDD habitability
   * states: -1 = uninhabitable, 0 = partial, +1 = full. Thresholds are picked at
   * the midpoints between the canonical habitability constants so a tile sitting
   * exactly at a constant lands in the bucket the constant names. Effective hab
   * of 0 (e.g., a tile damaged below floor) maps to "uninhabitable", since the
   * GDD treats it as ungrowable and unproductive.
   */
  private bucketForHab(effectiveHab: number): -1 | 0 | 1 {
    if (effectiveHab >= (HABITABILITY_NEBULA + HABITABILITY_OPEN_SPACE) / 2) {
      return 1;
    }
    if (effectiveHab >= (HABITABILITY_ASTEROID + HABITABILITY_NEBULA) / 2) {
      return 0;
    }
    return -1;
  }

  /**
   * Apply a +/- delta to one of the three per-player habitability bucket
   * counters. Pulled out of the larger record/recompute methods so the bucket
   * bookkeeping stays trivially auditable.
   */
  private adjustBucket(
    playerSmallID: number,
    bucket: -1 | 0 | 1,
    delta: number,
  ): void {
    if (bucket === 1) {
      this.perPlayerFullHabTileCount[playerSmallID] = Math.max(
        0,
        (this.perPlayerFullHabTileCount[playerSmallID] ?? 0) + delta,
      );
    } else if (bucket === 0) {
      this.perPlayerPartialHabTileCount[playerSmallID] = Math.max(
        0,
        (this.perPlayerPartialHabTileCount[playerSmallID] ?? 0) + delta,
      );
    } else {
      this.perPlayerUninhabTileCount[playerSmallID] = Math.max(
        0,
        (this.perPlayerUninhabTileCount[playerSmallID] ?? 0) + delta,
      );
    }
  }

  /**
   * O(1) count of owned sector tiles classified as **fully habitable**
   * (effective habitability ≥ ~OpenSpace). Used by GDD §3 economy formulas.
   */
  playerFullHabTiles(player: Player | PlayerView): number {
    const id = player.smallID();
    return this.perPlayerFullHabTileCount[id] ?? 0;
  }

  /**
   * O(1) count of owned sector tiles classified as **partially habitable**
   * (effective habitability ≈ Nebula). Used by GDD §3 economy formulas.
   */
  playerPartialHabTiles(player: Player | PlayerView): number {
    const id = player.smallID();
    return this.perPlayerPartialHabTileCount[id] ?? 0;
  }

  /**
   * O(1) count of owned sector tiles classified as **uninhabitable**
   * (effective habitability ≤ AsteroidField). Exposed for symmetry / UI use;
   * the economy formulas treat these tiles as zero-yield.
   */
  playerUninhabTiles(player: Player | PlayerView): number {
    const id = player.smallID();
    return this.perPlayerUninhabTileCount[id] ?? 0;
  }

  /**
   * O(1) GDD §9 weighted yield query: the running sum of
   * `(fullTiles + partialTiles) × sectorModifier` across every sector
   * the player owns yielding tiles in. Mirrors
   * `playerFullHabTiles + playerPartialHabTiles` but weighted by the
   * per-sector resource modifier, so `creditAdditionRate()` can credit
   * lucky sectors more than unlucky ones without a per-tick walk over
   * the player's tile set.
   *
   * Returns `0` for players with no tracked totals (unknown smallID,
   * or a player who owns only non-sector / uninhabitable tiles).
   * Accepts both `Player` and `PlayerView` — the running total is
   * keyed by `smallID()` so the client HUD reads the same authoritative
   * value the server tick does.
   */
  playerWeightedYieldTiles(player: Player | PlayerView): number {
    const id = player.smallID();
    return this.perPlayerWeightedYieldSum[id] ?? 0;
  }

  /**
   * O(1) average habitability across the player's owned **sector** tiles.
   *
   * Non-sector tiles (DebrisField / DeepSpace, never normally owned) do
   * not contribute — only tiles with a non-zero sector ID are tracked in
   * {@link perPlayerHabitabilitySum}. Returns `1.0` when the player owns
   * no sector tiles, which is the no-op identity for the population-growth
   * multiplier and the volume credit bonus. Accepts both `Player` and
   * `PlayerView`; see {@link playerOwnedSectorTiles}.
   */
  playerAverageHabitability(player: Player | PlayerView): number {
    const id = player.smallID();
    const count = this.perPlayerSectorTileCount[id] ?? 0;
    if (count === 0) return 1.0;
    return (this.perPlayerHabitabilitySum[id] ?? 0) / count;
  }

  /**
   * Effective habitability of `tile` after LRW damage. Returns the base
   * terrain habitability minus any cumulative damage applied to this tile,
   * floored at 0. Use this any time a habitability score for a single tile
   * is needed downstream of LRW strikes.
   */
  effectiveHabitability(tile: TileRef): number {
    const base = habitabilityForTerrain(this.gameMap.terrainType(tile));
    const damage = this.habitabilityDamage.get(tile) ?? 0;
    return Math.max(0, base - damage);
  }

  /**
   * Apply `amount` habitability damage to `tile` (Long-Range Weapon hit).
   * Updates the sparse damage overlay AND, if the tile is currently owned
   * by a player, decrements that player's running habitability sum by the
   * delta so the O(1) economy queries stay consistent. No-op for non-sector
   * tiles. Damage saturates once the tile's effective habitability hits 0.
   *
   * @param tile      The tile to damage.
   * @param amount    Habitability points to subtract (0..1).
   * @param ownerSmallID The current owner's `smallID`, or `null` if the
   *                     tile is unowned. Passed by the caller because
   *                     SectorMap doesn't have a back-reference to the
   *                     authoritative player table.
   */
  applyHabitabilityDamage(
    tile: TileRef,
    amount: number,
    ownerSmallID: number | null,
  ): void {
    if (amount <= 0) return;
    const sectorId = this.sectorIds[tile];
    if (sectorId === 0) return;
    const base = habitabilityForTerrain(this.gameMap.terrainType(tile));
    const prevDamage = this.habitabilityDamage.get(tile) ?? 0;
    // Saturate at the base habitability — damage past zero is meaningless.
    const newDamage = Math.min(base, prevDamage + amount);
    const delta = newDamage - prevDamage;
    if (delta <= 0) return;
    this.habitabilityDamage.set(tile, newDamage);

    if (ownerSmallID !== null) {
      // Decrement the owner's running sum by the same delta so the
      // averaged hab query stays in sync without re-summing every tile.
      this.perPlayerHabitabilitySum[ownerSmallID] = Math.max(
        0,
        (this.perPlayerHabitabilitySum[ownerSmallID] ?? 0) - delta,
      );
      // Bucket transition: prevDamage gave one effective hab, newDamage gives
      // another. If the bucket changed, swap the per-player tile from the old
      // bucket to the new one. (No-op when the damage is small enough that
      // the tile stays inside the same bucket.)
      const prevEffective = Math.max(0, base - prevDamage);
      const newEffective = Math.max(0, base - newDamage);
      const prevBucket = this.bucketForHab(prevEffective);
      const newBucket = this.bucketForHab(newEffective);
      if (prevBucket !== newBucket) {
        this.adjustBucket(ownerSmallID, prevBucket, -1);
        this.adjustBucket(ownerSmallID, newBucket, +1);
        // GDD §9 — track yielding/non-yielding crossings for the
        // weighted sum. A bucket swap that stays on the yielding side
        // (full ↔ partial) is a no-op for the weighted sum because the
        // modifier is applied per-tile regardless of full-vs-partial.
        // Only crossings into or out of the uninhabitable bucket matter.
        const wasYielding = prevBucket !== -1;
        const isYielding = newBucket !== -1;
        if (wasYielding !== isYielding) {
          const modifier = this.sectorResourceModifier(sectorId);
          if (wasYielding) {
            this.perPlayerWeightedYieldSum[ownerSmallID] = Math.max(
              0,
              (this.perPlayerWeightedYieldSum[ownerSmallID] ?? 0) - modifier,
            );
          } else {
            this.perPlayerWeightedYieldSum[ownerSmallID] =
              (this.perPlayerWeightedYieldSum[ownerSmallID] ?? 0) + modifier;
          }
        }
      }
    }
  }

  /** Test/debug accessor — current habitability damage on `tile`. */
  habitabilityDamageOf(tile: TileRef): number {
    return this.habitabilityDamage.get(tile) ?? 0;
  }

  /**
   * Record that `playerSmallID` gained ownership of `tile`. Called from
   * GameImpl.conquer after the tile's owner has been updated. No-op for
   * non-sector tiles.
   */
  recordTileGained(playerSmallID: number, tile: TileRef): void {
    const sectorId = this.sectorIds[tile];
    if (sectorId === 0) return;
    const hab = this.effectiveHabitability(tile);
    this.perPlayerSectorTileCount[playerSmallID] =
      (this.perPlayerSectorTileCount[playerSmallID] ?? 0) + 1;
    this.perPlayerHabitabilitySum[playerSmallID] =
      (this.perPlayerHabitabilitySum[playerSmallID] ?? 0) + hab;
    const bucket = this.bucketForHab(hab);
    this.adjustBucket(playerSmallID, bucket, +1);
    // GDD §9 — a newly-owned *yielding* tile (full or partial hab)
    // contributes its sector's resource modifier to the weighted yield
    // sum. Uninhabitable tiles are excluded because the credit formula
    // treats them as zero yield.
    if (bucket !== -1) {
      this.perPlayerWeightedYieldSum[playerSmallID] =
        (this.perPlayerWeightedYieldSum[playerSmallID] ?? 0) +
        this.sectorResourceModifier(sectorId);
    }
  }

  /**
   * Scout Swarm terraforming (Ticket 6) mutates a tile's underlying terrain
   * via {@link GameMap.setTerrainType}, which means the *base* habitability
   * of that tile changes on the fly. Call this after every such mutation so
   * the owner's running habitability sum stays in sync with the new
   * `effectiveHabitability` reading. No-op for non-sector tiles and when the
   * tile is unowned.
   *
   * `previousHabitability` is the value the caller observed *before* the
   * terrain was mutated. Passing it in (rather than storing a shadow copy
   * inside SectorMap) avoids a second terrainType() lookup on the hot path
   * and mirrors how {@link applyHabitabilityDamage} computes deltas.
   *
   * @param tile                 The tile whose base terrain just changed.
   * @param ownerSmallID         The tile's current owner `smallID`, or `null`
   *                             when the tile is unowned. No-op in that case.
   * @param previousHabitability The effective habitability of this tile
   *                             *before* the terrain change, as returned by
   *                             {@link effectiveHabitability} just prior to
   *                             the mutation.
   */
  recomputeHabitabilityForTile(
    tile: TileRef,
    ownerSmallID: number | null,
    previousHabitability: number,
  ): void {
    const sectorId = this.sectorIds[tile];
    if (sectorId === 0) return;
    if (ownerSmallID === null) return;
    const newHab = this.effectiveHabitability(tile);
    const delta = newHab - previousHabitability;
    if (delta === 0) return;
    this.perPlayerHabitabilitySum[ownerSmallID] = Math.max(
      0,
      (this.perPlayerHabitabilitySum[ownerSmallID] ?? 0) + delta,
    );
    const prevBucket = this.bucketForHab(previousHabitability);
    const newBucket = this.bucketForHab(newHab);
    if (prevBucket !== newBucket) {
      this.adjustBucket(ownerSmallID, prevBucket, -1);
      this.adjustBucket(ownerSmallID, newBucket, +1);
      // GDD §9 — same yielding/non-yielding crossing logic as
      // {@link applyHabitabilityDamage}. Scout-swarm terraforming an
      // asteroid into a nebula crosses uninhabitable → partial and
      // starts contributing the sector's modifier to the weighted sum.
      const wasYielding = prevBucket !== -1;
      const isYielding = newBucket !== -1;
      if (wasYielding !== isYielding) {
        const modifier = this.sectorResourceModifier(sectorId);
        if (wasYielding) {
          this.perPlayerWeightedYieldSum[ownerSmallID] = Math.max(
            0,
            (this.perPlayerWeightedYieldSum[ownerSmallID] ?? 0) - modifier,
          );
        } else {
          this.perPlayerWeightedYieldSum[ownerSmallID] =
            (this.perPlayerWeightedYieldSum[ownerSmallID] ?? 0) + modifier;
        }
      }
    }
  }

  /**
   * Record that `playerSmallID` lost ownership of `tile`. Called from
   * GameImpl.conquer (for the previous owner) and GameImpl.relinquish.
   * No-op for non-sector tiles.
   */
  recordTileLost(playerSmallID: number, tile: TileRef): void {
    const sectorId = this.sectorIds[tile];
    if (sectorId === 0) return;
    const hab = this.effectiveHabitability(tile);
    const count = this.perPlayerSectorTileCount[playerSmallID] ?? 0;
    if (count <= 1) {
      this.perPlayerSectorTileCount[playerSmallID] = 0;
      this.perPlayerHabitabilitySum[playerSmallID] = 0;
      this.perPlayerFullHabTileCount[playerSmallID] = 0;
      this.perPlayerPartialHabTileCount[playerSmallID] = 0;
      this.perPlayerUninhabTileCount[playerSmallID] = 0;
      // Last tile — zero the weighted sum so float drift doesn't leak
      // across an ownership wipe. Matches the bucket-counter reset above.
      this.perPlayerWeightedYieldSum[playerSmallID] = 0;
    } else {
      this.perPlayerSectorTileCount[playerSmallID] = count - 1;
      this.perPlayerHabitabilitySum[playerSmallID] = Math.max(
        0,
        (this.perPlayerHabitabilitySum[playerSmallID] ?? 0) - hab,
      );
      const bucket = this.bucketForHab(hab);
      this.adjustBucket(playerSmallID, bucket, -1);
      // GDD §9 — decrement the weighted sum only when the lost tile was
      // yielding (full/partial). Lost uninhabitable tiles never
      // contributed in the first place.
      if (bucket !== -1) {
        this.perPlayerWeightedYieldSum[playerSmallID] = Math.max(
          0,
          (this.perPlayerWeightedYieldSum[playerSmallID] ?? 0) -
            this.sectorResourceModifier(sectorId),
        );
      }
    }
  }
}
