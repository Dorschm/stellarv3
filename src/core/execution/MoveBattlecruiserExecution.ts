import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class MoveBattlecruiserExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly position: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(
        `MoveBattlecruiserExecution: position ${this.position} not valid`,
      );
      return;
    }
    const battlecruiser = this.owner
      .units(UnitType.Battlecruiser)
      .find((u) => u.id() === this.unitId);
    if (!battlecruiser) {
      console.warn("MoveBattlecruiserExecution: battlecruiser not found");
      return;
    }
    if (!battlecruiser.isActive()) {
      console.warn("MoveBattlecruiserExecution: battlecruiser is not active");
      return;
    }
    // Cruisers can only physically occupy void tiles (DeepSpace etc.) —
    // BattlecruiserExecution.randomTile() rejects non-void targets and
    // BattlecruiserExecution.patrol()'s pathfinder won't path onto sector
    // tiles. If the user clicked on a sector tile (e.g. on a planet),
    // resolve to the nearest void tile first so the move actually
    // happens. Otherwise the previous code (which only set patrolTile +
    // cleared targetTile) left the cruiser sitting at its old position
    // because no valid random tile could be chosen near the new patrol
    // center.
    const destination = mg.isVoid(this.position)
      ? this.position
      : findNearestVoid(mg, this.position);
    if (destination === null) {
      console.warn(
        "MoveBattlecruiserExecution: no void tile reachable near " +
          `(${mg.x(this.position)}, ${mg.y(this.position)})`,
      );
      return;
    }
    // Set both: patrolTile updates the cruiser's "home" radius for
    // randomTile() picks once it arrives, targetTile drives the
    // immediate direct travel via patrol()'s pathfinder.
    battlecruiser.setPatrolTile(destination);
    battlecruiser.setTargetTile(destination);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/**
 * Spiral outward from `origin` and return the first void tile encountered,
 * or null if no void tile exists within `MAX_SEARCH_RADIUS` tiles.
 *
 * Used by MoveBattlecruiserExecution to clamp a click on a sector (planet)
 * tile to a navigable void tile so the cruiser can actually path to a
 * sensible nearby destination instead of getting wedged.
 */
function findNearestVoid(mg: Game, origin: TileRef): TileRef | null {
  if (mg.isVoid(origin)) return origin;
  const ox = mg.x(origin);
  const oy = mg.y(origin);
  const MAX_SEARCH_RADIUS = 100;
  for (let r = 1; r <= MAX_SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only check the perimeter of each ring to avoid re-scanning.
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = ox + dx;
        const y = oy + dy;
        if (!mg.isValidCoord(x, y)) continue;
        const ref = mg.ref(x, y);
        if (mg.isVoid(ref)) return ref;
      }
    }
  }
  return null;
}
