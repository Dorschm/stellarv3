import { Execution, Game, Player, Tick, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { BattlecruiserExecution } from "./BattlecruiserExecution";
import { MirvExecution } from "./ClusterWarheadExecution";
import { ColonyExecution } from "./ColonyExecution";
import { DefenseStationExecution } from "./DefenseStationExecution";
import { FoundryExecution } from "./FoundryExecution";
import { JumpGateExecution } from "./JumpGateExecution";
import { NukeExecution } from "./NukeExecution";
import { OrbitalStrikePlatformExecution } from "./OrbitalStrikePlatformExecution";
import { PointDefenseArrayExecution } from "./PointDefenseArrayExecution";
import { ScoutSwarmExecution } from "./ScoutSwarmExecution";
import { SpaceportExecution } from "./SpaceportExecution";

export class ConstructionExecution implements Execution {
  private structure: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
    private rocketDirectionUp?: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (this.mg.config().isUnitDisabled(this.constructionType)) {
      console.warn(
        `cannot build construction ${this.constructionType} because it is disabled`,
      );
      this.active = false;
      return;
    }

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`cannot build construction invalid tile ${this.tile}`);
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    if (this.structure === null) {
      const info = this.mg.unitInfo(this.constructionType);
      // For non-structure units (nukes/battlecruiser), charge once and delegate to specialized executions.
      const isStructure = this.isStructure(this.constructionType);
      if (!isStructure) {
        // Defer validation and credit deduction to the specific execution
        this.completeConstruction();
        this.active = false;
        return;
      }

      // GDD §14 / Ticket 6 — Battlecruiser structure slot. Before falling
      // back to the normal ground-based structure build path, check whether
      // the target tile has a Battlecruiser owned by the player with an
      // empty structure slot. If so, host the new structure directly on
      // the ship: skip construction time, charge the normal cost, and
      // attach via `setSlottedStructure`.
      const hostCruiser = this.findHostBattlecruiser(this.tile);
      if (hostCruiser !== null) {
        this.structure = this.player.buildUnit(
          this.constructionType,
          hostCruiser.tile(),
          {},
        );
        hostCruiser.setSlottedStructure(this.structure);
        this.completeConstruction();
        this.active = false;
        return;
      }

      // Structures: build real unit and mark under construction
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      this.structure = this.player.buildUnit(
        this.constructionType,
        spawnTile,
        {},
      );
      const duration = info.constructionDuration ?? 0;
      if (duration > 0) {
        this.structure.setUnderConstruction(true);
        this.ticksUntilComplete = duration;
        return;
      }
      // No construction time
      this.completeConstruction();
      this.active = false;
      return;
    }

    if (!this.structure.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.structure.owner()) {
      this.player = this.structure.owner();
    }

    if (this.ticksUntilComplete === 0) {
      this.player = this.structure.owner();
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    if (this.structure) {
      this.structure.setUnderConstruction(false);
    }
    const player = this.player;
    switch (this.constructionType) {
      case UnitType.AntimatterTorpedo:
      case UnitType.NovaBomb:
        this.mg.addExecution(
          new NukeExecution(
            this.constructionType,
            player,
            this.tile,
            null,
            -1,
            0,
            this.rocketDirectionUp,
          ),
        );
        break;
      case UnitType.ClusterWarhead:
        this.mg.addExecution(new MirvExecution(player, this.tile));
        break;
      case UnitType.Battlecruiser:
        this.mg.addExecution(
          new BattlecruiserExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      case UnitType.Spaceport:
        this.mg.addExecution(new SpaceportExecution(this.structure!));
        break;
      case UnitType.OrbitalStrikePlatform:
        this.mg.addExecution(
          new OrbitalStrikePlatformExecution(this.structure!),
        );
        break;
      case UnitType.DefenseStation:
        this.mg.addExecution(new DefenseStationExecution(this.structure!));
        break;
      case UnitType.PointDefenseArray:
        this.mg.addExecution(
          new PointDefenseArrayExecution(player, null, this.structure!),
        );
        break;
      case UnitType.Colony:
        this.mg.addExecution(new ColonyExecution(this.structure!));
        break;
      case UnitType.Foundry:
        this.mg.addExecution(new FoundryExecution(this.structure!));
        break;
      case UnitType.JumpGate:
        this.mg.addExecution(new JumpGateExecution(this.structure!));
        break;
      case UnitType.ScoutSwarm:
        // Scout Swarm launches are zero-construction-time. The execution
        // handles the percentage credit deduction and spawn-tile selection
        // on its own `init()` pass.
        this.mg.addExecution(new ScoutSwarmExecution(player, this.tile));
        break;
      default:
        console.warn(
          `unit type ${this.constructionType} cannot be constructed`,
        );
        break;
    }
  }

  private isStructure(type: UnitType): boolean {
    switch (type) {
      case UnitType.Spaceport:
      case UnitType.OrbitalStrikePlatform:
      case UnitType.DefenseStation:
      case UnitType.PointDefenseArray:
      case UnitType.Colony:
      case UnitType.Foundry:
      case UnitType.JumpGate:
        return true;
      default:
        return false;
    }
  }

  /**
   * GDD §14 / Ticket 6 — Battlecruiser one-slot hosting. Returns the
   * Battlecruiser that should host this construction if:
   *   - The construction type is a supported slot payload (DefenseStation
   *     or OrbitalStrikePlatform).
   *   - There is an active, player-owned Battlecruiser within a 1-tile
   *     radius of the target tile (so right-clicking the cruiser's tile —
   *     or a neighbour — picks it up).
   *   - That cruiser has an empty structure slot.
   * Otherwise returns `null` so the caller falls back to ground-based
   * structure placement.
   */
  private findHostBattlecruiser(tile: TileRef): Unit | null {
    if (
      this.constructionType !== UnitType.DefenseStation &&
      this.constructionType !== UnitType.OrbitalStrikePlatform
    ) {
      return null;
    }
    const nearby = this.mg.nearbyUnits(tile, 2, [UnitType.Battlecruiser]);
    for (const { unit } of nearby) {
      if (
        unit.owner() === this.player &&
        unit.isActive() &&
        unit.slottedStructure() === undefined
      ) {
        return unit;
      }
    }
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
