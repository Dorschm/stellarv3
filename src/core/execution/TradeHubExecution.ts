import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TradeHub } from "../game/TradeHub";
import { PseudoRandom } from "../PseudoRandom";
import { FrigateExecution } from "./FrigateExecution";

export class TradeHubExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private random: PseudoRandom;
  private station: TradeHub | null = null;
  private numCars: number = 5;
  private lastSpawnTick: number = 0;
  private ticksCooldown: number = 10; // Minimum cooldown between two frigates
  constructor(
    private unit: Unit,
    private spawnFrigates?: boolean, // If set, the station will spawn frigates
  ) {
    this.unit.setTradeHub(true);
  }

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.spawnFrigates) {
      this.random = new PseudoRandom(mg.ticks());
    }
  }

  tick(ticks: number): void {
    if (this.mg === undefined) {
      throw new Error("Not initialized");
    }
    if (!this.isActive() || this.unit === undefined) {
      return;
    }
    if (this.station === null) {
      // Can't create new executions on init, so it has to be done in the tick
      this.station = new TradeHub(this.mg, this.unit);
      this.mg.hyperspaceLaneNetwork().connectStation(this.station);
    }
    if (!this.station.isActive()) {
      this.active = false;
      return;
    }
    if (this.spawnFrigates) {
      this.spawnFrigate(this.station, ticks);
    }
  }

  private shouldSpawnFrigate(): boolean {
    const spawnRate = this.mg
      .config()
      .frigateSpawnRate(this.unit.owner().unitCount(UnitType.Foundry));
    for (let i = 0; i < this.unit!.level(); i++) {
      if (this.random.chance(spawnRate)) {
        return true;
      }
    }
    return false;
  }

  private spawnFrigate(station: TradeHub, currentTick: number) {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (!this.spawnFrigates) return;
    if (this.random === undefined) throw new Error("Not initialized");
    if (currentTick < this.lastSpawnTick + this.ticksCooldown) return;
    const cluster = station.getCluster();
    if (cluster === null) {
      return;
    }
    const owner = this.unit.owner();
    if (!cluster.hasAnyTradeDestination(owner)) {
      return;
    }
    if (!this.shouldSpawnFrigate()) {
      return;
    }

    // Pick a destination randomly.
    // Could be improved to pick a lucrative trip
    const destination = cluster.randomTradeDestination(owner, this.random);
    if (destination === null) return;
    if (destination === station) return;

    this.mg.addExecution(
      new FrigateExecution(
        this.mg.hyperspaceLaneNetwork(),
        owner,
        station,
        destination,
        this.numCars,
      ),
    );
    this.lastSpawnTick = currentTick;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
