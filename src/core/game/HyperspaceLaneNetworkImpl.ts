import { PathFinding } from "../pathfinding/PathFinder";
import { Game, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { HyperspaceLane } from "./HyperspaceLane";
import { HyperspaceLaneNetwork } from "./HyperspaceLaneNetwork";
import { HyperspaceLaneSpatialGrid } from "./HyperspaceLaneSpatialGrid";
import { Cluster, TradeHub } from "./TradeHub";

/**
 * The Stations handle their own neighbors so the graph is naturally traversable,
 * but it would be expensive to look through the graph to find a station.
 * This class stores the existing stations for quick access
 */
export interface StationManager {
  addStation(station: TradeHub): void;
  removeStation(station: TradeHub): void;
  findStation(unit: Unit): TradeHub | null;
  getAll(): Set<TradeHub>;
  getById(id: number): TradeHub | undefined;
  count(): number;
}

export class StationManagerImpl implements StationManager {
  private stations: Set<TradeHub> = new Set();
  private stationsById: (TradeHub | undefined)[] = [];
  private nextId = 1; // Start from 1; 0 is reserved as invalid/sentinel

  addStation(station: TradeHub) {
    station.id = this.nextId++;
    this.stationsById[station.id] = station;
    this.stations.add(station);
  }

  removeStation(station: TradeHub) {
    this.stationsById[station.id] = undefined;
    this.stations.delete(station);
  }

  findStation(unit: Unit): TradeHub | null {
    for (const station of this.stations) {
      if (station.unit === unit) return station;
    }
    return null;
  }

  getAll(): Set<TradeHub> {
    return this.stations;
  }

  getById(id: number): TradeHub | undefined {
    return this.stationsById[id];
  }

  count(): number {
    return this.nextId;
  }
}

export interface HyperspaceLanePathFinderService {
  findTilePath(from: TileRef, to: TileRef): TileRef[];
  findStationsPath(from: TradeHub, to: TradeHub): TradeHub[];
}

class HyperspaceLanePathFinderServiceImpl
  implements HyperspaceLanePathFinderService
{
  constructor(private game: Game) {}

  findTilePath(from: TileRef, to: TileRef): TileRef[] {
    return PathFinding.Rail(this.game).findPath(from, to) ?? [];
  }

  findStationsPath(from: TradeHub, to: TradeHub): TradeHub[] {
    return PathFinding.Stations(this.game).findPath(from, to) ?? [];
  }
}

export function createHyperspaceLaneNetwork(game: Game): HyperspaceLaneNetwork {
  const stationManager = new StationManagerImpl();
  const pathService = new HyperspaceLanePathFinderServiceImpl(game);
  return new HyperspaceLaneNetworkImpl(game, stationManager, pathService);
}

export class HyperspaceLaneNetworkImpl implements HyperspaceLaneNetwork {
  private maxConnectionDistance: number = 4;
  private stationRadius: number = 3;
  private gridCellSize: number = 4;
  private hyperspaceLaneGrid: HyperspaceLaneSpatialGrid;
  private nextId: number = 0;
  private dirtyClusters = new Set<Cluster>();

  constructor(
    private game: Game,
    private _stationManager: StationManager,
    private pathService: HyperspaceLanePathFinderService,
  ) {
    this.hyperspaceLaneGrid = new HyperspaceLaneSpatialGrid(
      game,
      this.gridCellSize,
    ); // 4x4 tiles spatial grid
  }

  stationManager(): StationManager {
    return this._stationManager;
  }

  connectStation(station: TradeHub) {
    this._stationManager.addStation(station);
    if (!this.connectToExistingRails(station)) {
      this.connectToNearbyStations(station);
    }
  }

  recomputeClusters() {
    if (this.dirtyClusters.size === 0) return;

    for (const cluster of this.dirtyClusters) {
      const allOriginalStations = new Set(cluster.stations);
      while (allOriginalStations.size > 0) {
        const nextStation = allOriginalStations.values().next().value;
        const allConnectedStations = this.computeCluster(nextStation);
        // Filter stations that are connected to the current cluster
        for (const connectedStation of allConnectedStations) {
          allOriginalStations.delete(connectedStation);
        }
        // Those stations were disconnected: new cluster
        if (allOriginalStations.size > 0) {
          const newCluster = new Cluster();
          // Switching their cluster will automatically remove them from their current cluster
          newCluster.addStations(allConnectedStations);
        }
      }
    }
    this.dirtyClusters.clear();
  }

  removeStation(unit: Unit): void {
    const station = this._stationManager.findStation(unit);
    if (!station) return;

    this.disconnectFromNetwork(station);
    this._stationManager.removeStation(station);
    station.unit.setTradeHub(false);

    const cluster = station.getCluster();
    if (!cluster) return;

    cluster.removeStation(station);
    if (cluster.size() === 0) {
      this.deleteCluster(cluster);
      this.dirtyClusters.delete(cluster);
      return;
    }

    this.dirtyClusters.add(cluster);
  }

  /**
   * Return the intermediary stations connecting two stations
   */
  findStationsPath(from: TradeHub, to: TradeHub): TradeHub[] {
    return this.pathService.findStationsPath(from, to);
  }

  private connectToExistingRails(station: TradeHub): boolean {
    const rails = this.hyperspaceLaneGrid.query(
      station.tile(),
      this.stationRadius,
    );

    const editedClusters = new Set<Cluster>();
    for (const rail of rails) {
      const from = rail.from;
      const to = rail.to;
      const originalId = rail.id;
      const closestRailIndex = rail.getClosestTileIndex(
        this.game,
        station.tile(),
      );
      if (closestRailIndex === 0 || closestRailIndex >= rail.tiles.length) {
        continue;
      }

      // Disconnect current rail as it will become invalid
      from.removeRailroad(rail);
      to.removeRailroad(rail);
      this.hyperspaceLaneGrid.unregister(rail);

      const newRailFrom = new HyperspaceLane(
        from,
        station,
        rail.tiles.slice(0, closestRailIndex),
        this.nextId++,
      );
      const newRailTo = new HyperspaceLane(
        station,
        to,
        rail.tiles.slice(closestRailIndex),
        this.nextId++,
      );

      // New station is connected to both new rails
      station.addRailroad(newRailFrom);
      station.addRailroad(newRailTo);
      // From and to are connected to the new segments
      from.addRailroad(newRailFrom);
      to.addRailroad(newRailTo);

      this.hyperspaceLaneGrid.register(newRailTo);
      this.hyperspaceLaneGrid.register(newRailFrom);
      const cluster = from.getCluster();
      if (cluster) {
        cluster.addStation(station);
        editedClusters.add(cluster);
      }
      this.game.addUpdate({
        type: GameUpdateType.HyperspaceLaneSnapEvent,
        originalId,
        newId1: newRailFrom.id,
        newId2: newRailTo.id,
        tiles1: newRailFrom.tiles,
        tiles2: newRailTo.tiles,
      });
    }
    // If multiple clusters own the new station, merge them into a single cluster
    if (editedClusters.size > 1) {
      this.mergeClusters(editedClusters);
    }
    return editedClusters.size !== 0;
  }

  overlappingHyperspaceLanes(tile: TileRef): number[] {
    return [...this.hyperspaceLaneGrid.query(tile, this.stationRadius)].map(
      (lane: HyperspaceLane) => lane.id,
    );
  }

  private canSnapToExistingRailway(tile: TileRef): boolean {
    return this.hyperspaceLaneGrid.query(tile, this.stationRadius).size > 0;
  }

  computeGhostHyperspaceLanePaths(
    unitType: UnitType,
    tile: TileRef,
  ): TileRef[][] {
    // Factories already show their radius, so we'll exclude from ghost rails
    // in order not to clutter the interface too much.
    if (![UnitType.Colony, UnitType.Spaceport].includes(unitType)) {
      return [];
    }

    if (this.canSnapToExistingRailway(tile)) {
      return [];
    }

    const maxRange = this.game.config().tradeHubMaxRange();
    const minRangeSquared = this.game.config().tradeHubMinRange() ** 2;
    const maxPathSize = this.game.config().hyperspaceLaneMaxSize();

    // Cannot connect if outside the max range of a factory
    if (!this.game.hasUnitNearby(tile, maxRange, UnitType.Foundry)) {
      return [];
    }

    const neighbors = this.game.nearbyUnits(tile, maxRange, [
      UnitType.Colony,
      UnitType.Foundry,
      UnitType.Spaceport,
    ]);
    neighbors.sort((a, b) => a.distSquared - b.distSquared);

    const paths: TileRef[][] = [];
    const connectedStations: TradeHub[] = [];
    for (const neighbor of neighbors) {
      // Limit to the closest 5 stations to avoid running too many pathfinding calls.
      if (paths.length >= 5) break;
      if (neighbor.distSquared <= minRangeSquared) continue;

      const neighborStation = this._stationManager.findStation(neighbor.unit);
      if (!neighborStation) continue;

      const alreadyReachable = connectedStations.some(
        (s) =>
          this.distanceFrom(
            neighborStation,
            s,
            this.maxConnectionDistance - 1,
          ) !== -1,
      );
      if (alreadyReachable) continue;

      const path = this.pathService.findTilePath(tile, neighborStation.tile());
      if (path.length > 0 && path.length < maxPathSize) {
        paths.push(path);
        connectedStations.push(neighborStation);
      }
    }

    return paths;
  }

  private connectToNearbyStations(station: TradeHub) {
    const neighbors = this.game.nearbyUnits(
      station.tile(),
      this.game.config().tradeHubMaxRange(),
      [UnitType.Colony, UnitType.Foundry, UnitType.Spaceport],
    );

    const editedClusters = new Set<Cluster>();
    neighbors.sort((a, b) => a.distSquared - b.distSquared);

    for (const neighbor of neighbors) {
      if (neighbor.unit === station.unit) continue;
      const neighborStation = this._stationManager.findStation(neighbor.unit);
      if (!neighborStation) continue;

      const distanceToStation = this.distanceFrom(
        neighborStation,
        station,
        this.maxConnectionDistance,
      );

      const neighborCluster = neighborStation.getCluster();
      if (neighborCluster === null) continue;
      const connectionAvailable =
        distanceToStation > this.maxConnectionDistance ||
        distanceToStation === -1;
      if (
        connectionAvailable &&
        neighbor.distSquared > this.game.config().tradeHubMinRange() ** 2
      ) {
        if (this.connect(station, neighborStation)) {
          neighborCluster.addStation(station);
          editedClusters.add(neighborCluster);
        }
      }
    }

    // If multiple clusters own the new station, merge them into a single cluster
    if (editedClusters.size > 1) {
      this.mergeClusters(editedClusters);
    } else if (editedClusters.size === 0) {
      // If no cluster owns the station, creates a new one for it
      const newCluster = new Cluster();
      newCluster.addStation(station);
    }
  }

  private disconnectFromNetwork(station: TradeHub) {
    for (const rail of station.getRailroads()) {
      rail.delete(this.game);
      this.hyperspaceLaneGrid.unregister(rail);
    }
    station.clearRailroads();
  }

  private deleteCluster(cluster: Cluster) {
    for (const station of cluster.stations) {
      station.setCluster(null);
    }
    cluster.clear();
  }

  private connect(from: TradeHub, to: TradeHub) {
    const path = this.pathService.findTilePath(from.tile(), to.tile());
    if (
      path.length > 0 &&
      path.length < this.game.config().hyperspaceLaneMaxSize()
    ) {
      const lane = new HyperspaceLane(from, to, path, this.nextId++);
      this.game.addUpdate({
        type: GameUpdateType.HyperspaceLaneConstructionEvent,
        id: lane.id,
        tiles: lane.tiles,
      });
      from.addRailroad(lane);
      to.addRailroad(lane);
      this.hyperspaceLaneGrid.register(lane);
      return true;
    }
    return false;
  }

  private distanceFrom(
    start: TradeHub,
    dest: TradeHub,
    maxDistance: number,
  ): number {
    if (start === dest) return 0;

    const visited = new Set<TradeHub>();
    const queue: Array<{ station: TradeHub; distance: number }> = [
      { station: start, distance: 0 },
    ];

    while (queue.length > 0) {
      const { station, distance } = queue.shift()!;
      if (visited.has(station)) continue;
      visited.add(station);

      if (distance >= maxDistance) continue;

      for (const neighbor of station.neighbors()) {
        if (neighbor === dest) return distance + 1;
        if (!visited.has(neighbor)) {
          queue.push({ station: neighbor, distance: distance + 1 });
        }
      }
    }

    // If destination not found within maxDistance
    return -1;
  }

  private computeCluster(start: TradeHub): Set<TradeHub> {
    const visited = new Set<TradeHub>();
    const queue = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const neighbor of current.neighbors()) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    return visited;
  }

  private mergeClusters(clustersToMerge: Set<Cluster>) {
    const merged = new Cluster();
    for (const cluster of clustersToMerge) {
      merged.merge(cluster);
    }
  }
}
