import { Game } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { TradeHub } from "./TradeHub";

export class HyperspaceLane {
  constructor(
    public from: TradeHub,
    public to: TradeHub,
    public tiles: TileRef[],
    public id: number,
  ) {}

  delete(game: Game) {
    game.addUpdate({
      type: GameUpdateType.HyperspaceLaneDestructionEvent,
      id: this.id,
    });
    this.from.removeHyperspaceLane(this);
    this.to.removeHyperspaceLane(this);
  }

  getClosestTileIndex(game: Game, to: TileRef): number {
    if (this.tiles.length === 0) return -1;
    const toX = game.x(to);
    const toY = game.y(to);
    let closestIndex = 0;
    let minDistSquared = Infinity;
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      const dx = game.x(tile) - toX;
      const dy = game.y(tile) - toY;
      const distSquared = dx * dx + dy * dy;

      if (distSquared < minDistSquared) {
        minDistSquared = distSquared;
        closestIndex = i;
      }
    }
    return closestIndex;
  }
}

export function getOrientedHyperspaceLane(
  from: TradeHub,
  to: TradeHub,
): OrientedHyperspaceLane | null {
  const lane = from.getHyperspaceLaneTo(to);
  if (!lane) return null;
  // If tiles are stored from -> to, we go forward when lane.to === to
  const forward = lane.to === to;
  return new OrientedHyperspaceLane(lane, forward);
}

/**
 * Wrap a hyperspace lane with a direction so it always starts at tiles[0]
 */
export class OrientedHyperspaceLane {
  private tiles: TileRef[] = [];
  constructor(
    private lane: HyperspaceLane,
    private forward: boolean,
  ) {
    this.tiles = this.forward
      ? this.lane.tiles
      : [...this.lane.tiles].reverse();
  }

  getTiles(): TileRef[] {
    return this.tiles;
  }

  getStart(): TradeHub {
    return this.forward ? this.lane.from : this.lane.to;
  }

  getEnd(): TradeHub {
    return this.forward ? this.lane.to : this.lane.from;
  }
}
