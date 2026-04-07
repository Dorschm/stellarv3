import { FrigateExecution } from "../execution/FrigateExecution";
import { PseudoRandom } from "../PseudoRandom";
import { Game, Player, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { HyperspaceLane } from "./HyperspaceLane";

/**
 * Handle train stops at various station types
 */
interface TrainStopHandler {
  onStop(mg: Game, station: TradeHub, trainExecution: FrigateExecution): void;
}

class TradeStationStopHandler implements TrainStopHandler {
  onStop(mg: Game, station: TradeHub, trainExecution: FrigateExecution): void {
    const stationOwner = station.unit.owner();
    const trainOwner = trainExecution.owner();
    const gold = mg
      .config()
      .frigateCredits(
        rel(trainOwner, stationOwner),
        trainExecution.tradeStopsVisited(),
      );
    // Share revenue with the station owner if it's not the current player
    if (trainOwner !== stationOwner) {
      stationOwner.addCredits(gold, station.tile());
      mg.stats().frigateExternalTrade(trainOwner, gold);
    }
    trainOwner.addCredits(gold, station.tile());
    mg.stats().frigateSelfTrade(trainOwner, gold);
  }
}

class FactoryStopHandler implements TrainStopHandler {
  onStop(mg: Game, station: TradeHub, trainExecution: FrigateExecution): void {}
}

export function createTrainStopHandlers(
  random: PseudoRandom,
): Partial<Record<UnitType, TrainStopHandler>> {
  return {
    [UnitType.Colony]: new TradeStationStopHandler(),
    [UnitType.Spaceport]: new TradeStationStopHandler(),
    [UnitType.Foundry]: new FactoryStopHandler(),
  };
}

export class TradeHub {
  id: number = -1; // assigned by StationManager
  private readonly stopHandlers: Partial<Record<UnitType, TrainStopHandler>> =
    {};
  private cluster: Cluster | null = null;
  private railroads: Set<HyperspaceLane> = new Set();
  // Quick lookup from neighboring station to connecting railroad
  private railroadByNeighbor: Map<TradeHub, HyperspaceLane> = new Map();

  constructor(
    private mg: Game,
    public unit: Unit,
  ) {
    this.stopHandlers = createTrainStopHandlers(new PseudoRandom(mg.ticks()));
  }

  tradeAvailable(otherPlayer: Player): boolean {
    const player = this.unit.owner();
    return otherPlayer === player || player.canTrade(otherPlayer);
  }

  clearRailroads() {
    this.railroads.clear();
    this.railroadByNeighbor.clear();
  }

  addRailroad(railRoad: HyperspaceLane) {
    this.railroads.add(railRoad);
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    this.railroadByNeighbor.set(neighbor, railRoad);
  }

  removeRailroad(railRoad: HyperspaceLane) {
    this.railroads.delete(railRoad);
    const neighbor = railRoad.from === this ? railRoad.to : railRoad.from;
    this.railroadByNeighbor.delete(neighbor);
  }

  removeNeighboringRails(station: TradeHub) {
    const toRemove = [...this.railroads].find(
      (r) => r.from === station || r.to === station,
    );
    if (toRemove) {
      this.mg.addUpdate({
        type: GameUpdateType.HyperspaceLaneDestructionEvent,
        id: toRemove.id,
      });
      this.removeRailroad(toRemove);
    }
  }

  neighbors(): TradeHub[] {
    const neighbors: TradeHub[] = [];
    for (const r of this.railroads) {
      if (r.from !== this) {
        neighbors.push(r.from);
      } else {
        neighbors.push(r.to);
      }
    }
    return neighbors;
  }

  tile(): TileRef {
    return this.unit.tile();
  }

  isActive(): boolean {
    return this.unit.isActive();
  }

  getRailroads(): Set<HyperspaceLane> {
    return this.railroads;
  }

  getRailroadTo(station: TradeHub): HyperspaceLane | null {
    return this.railroadByNeighbor.get(station) ?? null;
  }

  setCluster(cluster: Cluster | null) {
    // Properly disconnect cluster if it's already set
    if (this.cluster !== null) {
      this.cluster.removeStation(this);
    }
    this.cluster = cluster;
  }

  getCluster(): Cluster | null {
    return this.cluster;
  }

  onTrainStop(trainExecution: FrigateExecution) {
    const type = this.unit.type();
    const handler = this.stopHandlers[type];
    if (handler) {
      handler.onStop(this.mg, this, trainExecution);
    }
  }
}

/**
 * Cluster of connected stations
 */
export class Cluster {
  public stations: Set<TradeHub> = new Set();
  private tradeStations: Set<TradeHub> = new Set();

  private isTradeStation(station: TradeHub): boolean {
    const type = station.unit.type();
    return type === UnitType.Colony || type === UnitType.Spaceport;
  }

  has(station: TradeHub) {
    return this.stations.has(station);
  }

  addStation(station: TradeHub) {
    this.stations.add(station);
    if (this.isTradeStation(station)) {
      this.tradeStations.add(station);
    }
    station.setCluster(this);
  }

  removeStation(station: TradeHub) {
    this.stations.delete(station);
    this.tradeStations.delete(station);
  }

  addStations(stations: Set<TradeHub>) {
    for (const station of stations) {
      this.addStation(station);
    }
  }

  merge(other: Cluster) {
    for (const s of other.stations) {
      this.addStation(s);
    }
  }

  hasAnyTradeDestination(player: Player): boolean {
    for (const station of this.tradeStations) {
      if (station.tradeAvailable(player)) {
        return true;
      }
    }
    return false;
  }

  randomTradeDestination(
    player: Player,
    random: PseudoRandom,
  ): TradeHub | null {
    let selected: TradeHub | null = null;
    let eligibleSeen = 0;

    for (const station of this.tradeStations) {
      if (!station.tradeAvailable(player)) continue;
      eligibleSeen++;

      // Reservoir sampling: keep each eligible station with probability 1/eligibleSeen.
      if (random.nextInt(0, eligibleSeen) === 0) {
        selected = station;
      }
    }

    return selected;
  }

  availableForTrade(player: Player): Set<TradeHub> {
    const tradingStations = new Set<TradeHub>();
    for (const station of this.tradeStations) {
      if (station.tradeAvailable(player)) {
        tradingStations.add(station);
      }
    }
    return tradingStations;
  }

  size() {
    return this.stations.size;
  }

  clear() {
    this.stations.clear();
    this.tradeStations.clear();
  }
}

function rel(
  player: Player,
  other: Player,
): "self" | "team" | "ally" | "other" {
  if (player === other) {
    return "self";
  }
  if (player.isOnSameTeam(other)) {
    return "team";
  }
  if (player.isAlliedWith(other)) {
    return "ally";
  }
  return "other";
}
