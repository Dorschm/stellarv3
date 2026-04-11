import { PlayerID, UnitType } from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { SectorMap } from "./SectorMap";

/**
 * Minimal seed description for {@link buildPlanets}. Both the manifest
 * `Nation` (client side, `TerrainMapLoader.Nation`) and the game-side
 * `Nation` class (server side, `Game.Nation` — a wrapper around a
 * `PlayerInfo` + spawn cell) can be projected onto this shape by the
 * caller, which avoids Planet.ts having to import either concrete type
 * directly and keeps the dependency graph one-way.
 */
export interface PlanetSeed {
  name: string;
  coordinates: readonly [number, number];
}

/**
 * GDD §2 / §4 — discrete habitability state. Mirrors the three buckets
 * `SectorMap` already tracks at the tile level, but lifted to per-planet
 * granularity so the rest of the game can reason about "this planet is
 * currently partial" without iterating tiles.
 *
 * The state is computed from the dominant bucket across the sector's
 * tiles: whichever bucket has the most tiles wins. Ties fall to the
 * higher tier (Full > Partial > Uninhabitable) because high-hab tiles
 * are scarcer and more valuable; biasing toward them prevents a single
 * Nebula tile on a mostly-Open-Space planet from dragging the label
 * into "Partial".
 */
export enum HabitabilityState {
  Uninhabitable = "Uninhabitable",
  Partial = "Partial",
  Full = "Full",
}

/**
 * GDD §4 — per-planet structure slot cap. The GDD phrases it as
 * "0 / 1 / 2 structures per planet" keyed on habitability:
 * Uninhabitable = 0, Partial = 1, Full = 2.
 *
 * Exposed as a const map so the single source of truth for the slot
 * cap lives alongside the Planet entity, and downstream code (build
 * menu, placement validation, scoring) can read from it without a
 * local conditional.
 */
export const PLANET_SLOT_LIMIT: Readonly<Record<HabitabilityState, number>> = {
  [HabitabilityState.Uninhabitable]: 0,
  [HabitabilityState.Partial]: 1,
  [HabitabilityState.Full]: 2,
};

/**
 * GDD §2 — a single first-class planet. Thin wrapper around a
 * `SectorMap` sector that supplies a stable id, a display name, and
 * convenience accessors for the GDD's §10 scoring and §4 slot rules.
 *
 * This is intentionally **not** where ownership or structures are
 * *stored* — that remains in `GameImpl` / `PlayerImpl` via the existing
 * tile-ownership and unit-by-tile machinery. Planet exposes read
 * methods that fan out to those authoritative sources on demand, so
 * there is no write-through bookkeeping to keep in sync.
 *
 * The GDD's "slot limit" and "habitability state" become functions of
 * the current sector state, not captured-at-spawn-time values, so a
 * planet terraformed from Uninhabitable → Partial by scout swarms is
 * automatically reflected in both its state *and* its slot limit next
 * time they are queried.
 */
export interface Planet {
  /**
   * Stable identity. Uses the same numeric id space as
   * `SectorMap.sectorOf()` so `game.planets()[i].id === i + 1` under
   * the canonical factory ordering (sector id 0 is reserved as "no
   * sector" and never produces a planet).
   */
  readonly id: number;
  /**
   * Back-reference to the underlying sector id in `SectorMap`.
   * Identical to `id` today, kept as a separate field so future work
   * can decouple the two without a breaking rename.
   */
  readonly sectorId: number;
  /** Display name, from the source {@link Nation}. */
  readonly name: string;
  /**
   * Seed tile coordinates of the sector, inherited from the source
   * `Nation.coordinates`. Needed by the HUD (`PlanetLandmarks`) to
   * anchor the 3D sphere and label without doing a per-tile scan.
   */
  readonly seedX: number;
  readonly seedY: number;

  /**
   * Total number of sector tiles that belong to this planet. Treated
   * as the GDD's planet "size in km²". Does not change during a run —
   * the BFS flood that builds the sector is a one-shot at game init.
   */
  tileCount(): number;

  /**
   * GDD §3.2 uses km³ as the unit for resource generation. Derived
   * from `tileCount` via `tileCount^1.5`, a quick stand-in for "area
   * → volume" that keeps smaller planets geometrically penalized
   * without requiring a separate volume field on the map.
   */
  volume(): number;

  /**
   * GDD §9 — random resource modifier in `[0.5, 2.0)` attached to
   * this planet. Reads directly from {@link SectorMap.sectorResourceModifier}
   * so the server, clients, and HUD all agree on the same value
   * without any network sync. Two planets of identical size and
   * habitability can still produce different credit rates based on
   * this roll, fulfilling the GDD "each planet has its own luck" goal.
   */
  resourceModifier(): number;

  /**
   * Dominant habitability bucket across the sector's tiles.
   * Recomputed from `SectorMap` buckets on each call so LRW damage
   * and Scout Swarm terraforming are reflected immediately.
   *
   * Note: this is an **aggregate** state for display/slot rules. The
   * GDD §3 economy formulas still operate on per-tile buckets via
   * `SectorMap.playerFullHabTiles` etc., not this single-value
   * summary.
   */
  habitabilityState(): HabitabilityState;

  /**
   * Current owner of the planet, defined as whichever player owns the
   * seed tile. Matches how the cosmetic `PlanetLandmarks` already
   * decides who to tint the sphere for. Returns `null` when the seed
   * tile is unowned.
   */
  ownerId(game: PlanetOwnerLookup): PlayerID | null;

  /**
   * GDD §4 — current structure slot cap. Reads directly from
   * {@link PLANET_SLOT_LIMIT} keyed on {@link habitabilityState}, so
   * terraforming a planet also grows its slot cap on the next query.
   */
  slotLimit(): number;

  /**
   * Structures currently built inside this planet's sector. Fans out
   * to {@link PlanetStructureLookup} which the caller wires to the
   * game's unit store; returns `[]` when no structures overlap.
   */
  structures(lookup: PlanetStructureLookup): readonly PlanetStructure[];
}

/** Minimal contract to look up the owner of a tile. */
export interface PlanetOwnerLookup {
  owner(tile: TileRef): { isPlayer(): boolean; id(): PlayerID | null };
}

/**
 * Minimal contract for fetching the structures on a planet. Kept as
 * a parameter on the read-only Planet API rather than a back-reference
 * so Planet can stay pure data plus a `SectorMap` pointer.
 */
export interface PlanetStructureLookup {
  /** All structure units owned by anyone, filtered to `type` if given. */
  units(...types: UnitType[]): Array<{
    type(): UnitType;
    tile(): TileRef;
    owner(): { id(): PlayerID | null };
  }>;
}

/**
 * Read-only snapshot of a single structure on a planet. Kept as a
 * plain object (not a class) so tests and the HUD can cheaply enumerate
 * them without pulling in the full `Unit` interface.
 */
export interface PlanetStructure {
  type: UnitType;
  tile: TileRef;
  ownerId: PlayerID | null;
}

class PlanetImpl implements Planet {
  constructor(
    public readonly id: number,
    public readonly sectorId: number,
    public readonly name: string,
    public readonly seedX: number,
    public readonly seedY: number,
    private readonly sectorMap: SectorMap,
    private readonly gameMap: GameMap,
  ) {}

  tileCount(): number {
    return this.sectorMap.sectorTileCount(this.sectorId);
  }

  volume(): number {
    const size = this.tileCount();
    if (size <= 0) return 0;
    // GDD §3.2 "km³" proxy. Area → volume via size^1.5 keeps smaller
    // planets geometrically penalized without introducing a new field
    // on the map data. Any future "true km³" value should override
    // this method on a subclass and leave the base formula untouched.
    return Math.pow(size, 1.5);
  }

  resourceModifier(): number {
    return this.sectorMap.sectorResourceModifier(this.sectorId);
  }

  habitabilityState(): HabitabilityState {
    // Walk the tile grid filtered by this sector id and count the
    // tiles that fall into each bucket via `effectiveHabitability`.
    // The SectorMap's per-player bucket counters are player-keyed,
    // not planet-keyed, so we can't reuse them directly here — but
    // this walk only happens when a caller explicitly asks for the
    // state (HUD, scoring, slot check), not every tick.
    let full = 0;
    let partial = 0;
    let uninhab = 0;
    const w = this.gameMap.width();
    const h = this.gameMap.height();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ref = this.gameMap.ref(x, y);
        if (this.sectorMap.sectorOf(ref) !== this.sectorId) continue;
        const hab = this.sectorMap.effectiveHabitability(ref);
        if (hab >= 0.8) full++;
        else if (hab >= 0.45) partial++;
        else uninhab++;
      }
    }
    // Tie-break toward the higher tier (see HabitabilityState doc).
    if (full >= partial && full >= uninhab) return HabitabilityState.Full;
    if (partial >= uninhab) return HabitabilityState.Partial;
    return HabitabilityState.Uninhabitable;
  }

  ownerId(game: PlanetOwnerLookup): PlayerID | null {
    if (!this.gameMap.isValidCoord(this.seedX, this.seedY)) return null;
    const seedRef = this.gameMap.ref(this.seedX, this.seedY);
    const owner = game.owner(seedRef);
    if (!owner.isPlayer()) return null;
    return owner.id();
  }

  slotLimit(): number {
    return PLANET_SLOT_LIMIT[this.habitabilityState()];
  }

  structures(lookup: PlanetStructureLookup): readonly PlanetStructure[] {
    // Union of the GDD §5 structure types. Kept inline here instead of
    // importing `Structures.types` so the Planet module has no
    // dependency on the buildmenu grouping — it only depends on the
    // UnitType enum, which is unlikely to change.
    const structureTypes: UnitType[] = [
      UnitType.Spaceport,
      UnitType.DefenseStation,
      UnitType.OrbitalStrikePlatform,
      UnitType.PointDefenseArray,
      UnitType.Colony,
      UnitType.Foundry,
      UnitType.JumpGate,
    ];
    const out: PlanetStructure[] = [];
    for (const u of lookup.units(...structureTypes)) {
      if (this.sectorMap.sectorOf(u.tile()) !== this.sectorId) continue;
      out.push({
        type: u.type(),
        tile: u.tile(),
        ownerId: u.owner().id(),
      });
    }
    return out;
  }
}

/**
 * GDD §2 — factory that wraps each non-empty sector in `sectorMap`
 * with a {@link Planet} object. Uses the manifest `nations` array to
 * pull display names and seed coordinates; sectors that don't have a
 * matching nation (shouldn't happen on a well-authored map but the
 * procedural generator leaves room) are skipped.
 *
 * Keeping the factory a free function rather than a static constructor
 * on the class lets the caller hand in just the map + sectorMap +
 * nations without the full `Game` surface, which is what `GameImpl`
 * construction actually has access to when planets are built.
 */
export function buildPlanets(
  sectorMap: SectorMap,
  gameMap: GameMap,
  nations: readonly PlanetSeed[],
): Planet[] {
  const planets: Planet[] = [];
  for (const nation of nations) {
    if (!nation) continue;
    const [x, y] = nation.coordinates;
    if (!gameMap.isValidCoord(x, y)) continue;
    const seedRef = gameMap.ref(x, y);
    const sectorId = sectorMap.sectorOf(seedRef);
    if (sectorId === 0) continue;
    // Guard against duplicate nations seeded inside the same flood
    // region — the flood skips repeat seeds, so two nations resolving
    // to the same sector would otherwise create two Planets with the
    // same id.
    if (planets.some((p) => p.sectorId === sectorId)) continue;
    planets.push(
      new PlanetImpl(sectorId, sectorId, nation.name, x, y, sectorMap, gameMap),
    );
  }
  // Stable order: ascending by sector id. The sector id is itself
  // assigned in the order nations appear in the manifest, so this
  // matches manifest order in practice while being robust to future
  // factories that build Planets from a non-manifest source.
  planets.sort((a, b) => a.sectorId - b.sectorId);
  return planets;
}
