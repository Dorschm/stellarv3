import {
  Execution,
  FrigateType,
  Game,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  getOrientedHyperspaceLane,
  OrientedHyperspaceLane,
} from "../game/HyperspaceLane";
import { HyperspaceLaneNetwork } from "../game/HyperspaceLaneNetwork";
import { MotionPlanRecord } from "../game/MotionPlans";
import { TradeHub } from "../game/TradeHub";

export class FrigateExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private engine: Unit | null = null; // primary unit
  private cars: Unit[] = []; // stored back to front
  private hasCargo: boolean = false;
  private currentTile: number = 0;
  private spacing = 2;
  private usedTiles: TileRef[] = []; // used for cars behind
  private stations: TradeHub[] = [];
  private currentHyperspaceLane: OrientedHyperspaceLane | null = null;
  private speed: number = 2;
  private _tradeStopsVisited: number = 0;

  constructor(
    private railNetwork: HyperspaceLaneNetwork,
    private player: Player,
    private source: TradeHub,
    private destination: TradeHub,
    private numCars: number,
  ) {}

  public owner(): Player {
    return this.player;
  }

  public tradeStopsVisited(): number {
    return this._tradeStopsVisited;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stations = this.railNetwork.findStationsPath(
      this.source,
      this.destination,
    );
    if (!stations || stations.length <= 1) {
      this.active = false;
      return;
    }

    this.stations = stations;
    const lane = getOrientedHyperspaceLane(this.stations[0], this.stations[1]);
    if (lane) {
      this.currentHyperspaceLane = lane;
    } else {
      this.active = false;
      return;
    }

    const spawn = this.player.canBuild(
      UnitType.Frigate,
      this.stations[0].tile(),
    );
    if (spawn === false) {
      console.warn(`cannot build frigate`);
      this.active = false;
      return;
    }
    this.engine = this.createFrigateUnits(spawn);

    const carUnitIds = this.cars.map((c) => c.id());
    const pathTiles: TileRef[] = [];
    for (let i = 0; i + 1 < this.stations.length; i++) {
      const segment = getOrientedHyperspaceLane(
        this.stations[i],
        this.stations[i + 1],
      );
      if (!segment) {
        this.active = false;
        return;
      }
      pathTiles.push(...segment.getTiles());
    }
    const startTile = this.engine.tile();
    if (pathTiles.length === 0 || pathTiles[0] !== startTile) {
      pathTiles.unshift(startTile);
    }

    const plan: MotionPlanRecord = {
      kind: "frigate",
      engineUnitId: this.engine.id(),
      carUnitIds,
      planId: 1,
      startTick: ticks + 1,
      speed: this.speed,
      spacing: this.spacing,
      path: pathTiles,
    };
    this.mg.recordMotionPlan(plan);
  }

  tick(ticks: number): void {
    if (this.engine === null) {
      throw new Error("Not initialized");
    }

    if (!this.engine.isActive() || !this.activeSourceOrDestination()) {
      this.deleteFrigate();
      return;
    }

    const tile = this.getNextTile();
    if (tile) {
      this.updateCarsPositions(tile);
    } else {
      this.targetReached();
      this.deleteFrigate();
    }
  }

  loadCargo() {
    if (this.hasCargo || this.engine === null) {
      return;
    }
    this.hasCargo = true;
    // Starts at 1: don't load tail engine
    for (let i = 1; i < this.cars.length; i++) {
      this.cars[i].setLoaded(true);
    }
  }

  private targetReached() {
    if (this.engine === null) {
      return;
    }
    this.engine.setReachedTarget();
    this.cars.forEach((car: Unit) => {
      car.setReachedTarget();
    });
  }

  private createFrigateUnits(tile: TileRef): Unit {
    const engine = this.player.buildUnit(UnitType.Frigate, tile, {
      targetUnit: this.destination.unit,
      frigateType: FrigateType.Engine,
    });
    // Tail is also an engine, just for cosmetics
    this.cars.push(
      this.player.buildUnit(UnitType.Frigate, tile, {
        targetUnit: this.destination.unit,
        frigateType: FrigateType.TailEngine,
      }),
    );
    for (let i = 0; i < this.numCars; i++) {
      this.cars.push(
        this.player.buildUnit(UnitType.Frigate, tile, {
          frigateType: FrigateType.Carriage,
          loaded: this.hasCargo,
        }),
      );
    }
    return engine;
  }

  private deleteFrigate() {
    this.active = false;
    if (this.engine?.isActive()) {
      this.engine.delete(false);
    }
    for (const car of this.cars) {
      if (car.isActive()) {
        car.delete(false);
      }
    }
  }

  private activeSourceOrDestination(): boolean {
    return (
      this.stations.length > 1 &&
      this.stations[1].isActive() &&
      this.stations[0].isActive()
    );
  }

  /**
   * Save the tiles the frigate goes through so the cars can reuse them
   * Don't simply save the tiles the engine uses, otherwise the spacing will be dictated by the frigate speed
   */
  private saveTraversedTiles(from: number, speed: number) {
    if (!this.currentHyperspaceLane) {
      return;
    }
    let tileToSave: number = from;
    for (
      let i = 0;
      i < speed && tileToSave < this.currentHyperspaceLane.getTiles().length;
      i++
    ) {
      this.saveTile(this.currentHyperspaceLane.getTiles()[tileToSave]);
      tileToSave = tileToSave + 1;
    }
  }

  private saveTile(tile: TileRef) {
    this.usedTiles.push(tile);
    if (this.usedTiles.length > this.cars.length * this.spacing + 3) {
      this.usedTiles.shift();
    }
  }

  private updateCarsPositions(newTile: TileRef) {
    if (this.cars.length > 0) {
      for (let i = this.cars.length - 1; i >= 0; --i) {
        const carTileIndex = (i + 1) * this.spacing + 2;
        if (this.usedTiles.length > carTileIndex) {
          this.cars[i].move(this.usedTiles[carTileIndex]);
        }
      }
    }
    if (this.engine !== null) {
      this.engine.move(newTile);
    }
  }

  private nextStation() {
    if (this.stations.length > 2) {
      this.stations.shift();
      const lane = getOrientedHyperspaceLane(
        this.stations[0],
        this.stations[1],
      );
      if (lane) {
        this.currentHyperspaceLane = lane;
        return true;
      }
    }
    return false;
  }

  private canTradeWithDestination() {
    return (
      this.stations.length > 1 && this.stations[1].tradeAvailable(this.player)
    );
  }

  private getNextTile(): TileRef | null {
    if (
      this.currentHyperspaceLane === null ||
      !this.canTradeWithDestination()
    ) {
      return null;
    }
    this.saveTraversedTiles(this.currentTile, this.speed);
    this.currentTile = this.currentTile + this.speed;
    const leftOver =
      this.currentTile - this.currentHyperspaceLane.getTiles().length;
    if (leftOver >= 0) {
      // Station reached, pick the next station
      this.stationReached();
      if (!this.nextStation()) {
        return null; // Destination reached (or no valid connection)
      }
      this.currentTile = leftOver;
      this.saveTraversedTiles(0, leftOver);
    }
    return this.currentHyperspaceLane.getTiles()[this.currentTile];
  }

  private stationReached() {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    this.stations[1].onFrigateStop(this);
    const stationType = this.stations[1].unit.type();
    if (stationType === UnitType.Colony || stationType === UnitType.Spaceport) {
      this._tradeStopsVisited++;
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
