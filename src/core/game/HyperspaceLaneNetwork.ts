import { Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { StationManager } from "./HyperspaceLaneNetworkImpl";
import { TradeHub } from "./TradeHub";

export interface HyperspaceLaneNetwork {
  connectStation(station: TradeHub): void;
  removeStation(unit: Unit): void;
  findStationsPath(from: TradeHub, to: TradeHub): TradeHub[];
  stationManager(): StationManager;
  overlappingHyperspaceLanes(tile: TileRef): number[];
  computeGhostHyperspaceLanePaths(
    unitType: UnitType,
    tile: TileRef,
  ): TileRef[][];
  recomputeClusters(): void;
}
