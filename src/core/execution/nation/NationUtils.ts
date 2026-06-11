import { Cell, Game, Player } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { calculateBoundingBox } from "../../Util";

export function randTerritoryTileArray(
  random: PseudoRandom,
  mg: Game,
  player: Player,
  numTiles: number,
): TileRef[] {
  const boundingBox = calculateBoundingBox(mg, player.borderTiles());
  const tiles: TileRef[] = [];
  for (let i = 0; i < numTiles; i++) {
    const tile = randTerritoryTile(random, mg, player, boundingBox);
    if (tile !== null) {
      tiles.push(tile);
    }
  }
  return tiles;
}

/**
 * Candidate-tile sampler dedicated to Jump Gate placement.
 *
 * Generic `randTerritoryTileArray()` sampling uniformly draws a handful of owned
 * tiles, which on large territories easily misses the hostile frontier entirely
 * — hostile-border tiles are a tiny fraction of the owned area. This sampler
 * instead anchors on a caller-supplied set of tiles (rival-facing border tiles
 * for a later gate, or centroid-near tiles for the first gate) and guarantees
 * those anchors — plus their owned neighbours, so the scorer can pick a tile a
 * few steps inside the border — appear in the result. Any remaining slots are
 * filled with generic interior tiles so the scorer always has fallbacks.
 */
export function jumpGateCandidateTiles(
  random: PseudoRandom,
  mg: Game,
  player: Player,
  anchorTiles: Iterable<TileRef>,
  numTiles: number,
): TileRef[] {
  // Anchor-derived candidates: each anchor plus its owned neighbours.
  const anchorCandidates = new Set<TileRef>();
  for (const tile of anchorTiles) {
    if (mg.owner(tile) === player) {
      anchorCandidates.add(tile);
    }
    for (const neighbor of mg.neighbors(tile)) {
      if (mg.owner(neighbor) === player) {
        anchorCandidates.add(neighbor);
      }
    }
  }

  const result: TileRef[] = [];

  // Anchor candidates take priority so the frontier is never sampled away.
  const anchorArray = Array.from(anchorCandidates);
  if (anchorArray.length > numTiles) {
    const remaining = new Set(anchorArray);
    while (result.length < numTiles) {
      const t = random.randFromSet(remaining);
      remaining.delete(t);
      result.push(t);
    }
    return result;
  }
  result.push(...anchorArray);

  // Fill the remaining slots with generic interior tiles as fallbacks.
  const seen = new Set(result);
  for (const tile of randTerritoryTileArray(random, mg, player, numTiles)) {
    if (result.length >= numTiles) {
      break;
    }
    if (seen.has(tile)) {
      continue;
    }
    seen.add(tile);
    result.push(tile);
  }

  return result;
}

function randTerritoryTile(
  random: PseudoRandom,
  mg: Game,
  p: Player,
  boundingBox: { min: Cell; max: Cell } | null = null,
): TileRef | null {
  // Eliminated players own no tiles: their bounding box degenerates to
  // Infinity coordinates and `randElement` would throw on the empty tile
  // array, aborting the whole game tick. Bail out instead — callers already
  // handle a null/empty result.
  if (p.numTilesOwned() === 0) {
    return null;
  }

  // Prefer sampling inside the bounding box first (fast, usually good enough)
  boundingBox ??= calculateBoundingBox(mg, p.borderTiles());
  for (let i = 0; i < 100; i++) {
    const randX = random.nextInt(boundingBox.min.x, boundingBox.max.x);
    const randY = random.nextInt(boundingBox.min.y, boundingBox.max.y);
    if (!mg.isOnMap(new Cell(randX, randY))) {
      // Sanity check should never happen
      continue;
    }
    const randTile = mg.ref(randX, randY);
    if (mg.owner(randTile) === p) {
      return randTile;
    }
  }

  if (p.numTilesOwned() <= 100) {
    return random.randElement(Array.from(p.tiles()));
  }

  return null;
}
