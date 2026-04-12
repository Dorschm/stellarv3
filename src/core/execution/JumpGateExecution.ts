import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Lifecycle execution for a Jump Gate structure (GDD §5).
 *
 * The Jump Gate itself has no per-tick behaviour beyond detecting
 * destruction — it is a passive teleport endpoint. The actual unit
 * transport logic lives in {@link JumpGateTravel.teleport}, which is
 * called by intent handlers (and tests) when the player elects to jump
 * a unit between two of their gates (or an allied gate).
 *
 * See Ticket 5: Structure Alignment — AU Convention, Long-Range Weapon,
 * Jump Gate.
 */
export class JumpGateExecution implements Execution {
  private active: boolean = true;
  private mg: Game;

  constructor(private gate: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (!this.gate.isActive()) {
      this.active = false;
      return;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/**
 * Static helpers for Jump Gate connectivity. These are pure functions over
 * `Game` state so the build menu, radial menu, intent handlers, and tests
 * can all share the same notion of "which gates can a player use right now".
 */
export class JumpGateTravel {
  /**
   * Lists every Jump Gate that `player` is allowed to teleport to/from.
   *
   * GDD §5 — alliance sharing: gates owned by the player OR by any active
   * ally count as valid endpoints. Gates that are still under construction
   * are excluded so a partially-built gate can't be used as a destination.
   */
  static availableGatesFor(game: Game, player: Player): Unit[] {
    const owned = player.units(UnitType.JumpGate);
    const result: Unit[] = [];
    for (const g of owned) {
      if (g.isActive() && !g.isUnderConstruction()) {
        result.push(g);
      }
    }
    for (const ally of player.allies()) {
      for (const g of ally.units(UnitType.JumpGate)) {
        if (g.isActive() && !g.isUnderConstruction()) {
          result.push(g);
        }
      }
    }
    return result;
  }

  /**
   * Finds the destinations reachable from `sourceGate` for `player`. The
   * source gate is excluded from the result. Returns an empty array if no
   * valid paired gate exists yet — the UI uses this to disable the
   * "Jump to gate" radial action when a single gate is built.
   */
  static destinationsFrom(
    game: Game,
    player: Player,
    sourceGate: Unit,
  ): Unit[] {
    return JumpGateTravel.availableGatesFor(game, player).filter(
      (g) => g.id() !== sourceGate.id(),
    );
  }

  /**
   * Teleport an existing unit from `sourceGate` to `destinationGate`.
   * Returns true on success. Both gates must be active, must not be under
   * construction, and the destination must be either owned by the unit's
   * owner or owned by an ally. The unit is moved instantly to the
   * destination gate's tile — no construction tick, no projectile.
   */
  static teleport(
    game: Game,
    unit: Unit,
    sourceGate: Unit,
    destinationGate: Unit,
  ): boolean {
    if (!sourceGate.isActive() || sourceGate.isUnderConstruction()) {
      return false;
    }
    if (!destinationGate.isActive() || destinationGate.isUnderConstruction()) {
      return false;
    }
    const owner = unit.owner();
    // Source ownership check — caller must control the source gate (or
    // share an alliance with the owner). This blocks the "use an enemy
    // gate" loophole that would otherwise turn captured gates into a
    // free attack vector.
    if (sourceGate.owner() !== owner && !sourceGate.owner().isFriendly(owner)) {
      return false;
    }
    if (
      destinationGate.owner() !== owner &&
      !destinationGate.owner().isFriendly(owner)
    ) {
      return false;
    }
    const destTile: TileRef = destinationGate.tile();
    unit.move(destTile);
    return true;
  }
}

/** Unit types eligible for mass teleport through a Jump Gate. */
const TELEPORTABLE_UNIT_TYPES: readonly UnitType[] = [
  UnitType.AssaultShuttle,
  UnitType.Battlecruiser,
  UnitType.ScoutSwarm,
  UnitType.TradeFreighter,
];

/**
 * One-shot execution that teleports all eligible mobile units on a source Jump
 * Gate tile to a destination Jump Gate tile, in response to a
 * `jump_gate_teleport` intent. Gates are discovered by tile rather than by ID
 * so the intent payload stays location-based. The execution completes in
 * `init()` — `isActive()` always returns `false`.
 */
export class JumpGateTeleportExecution implements Execution {
  constructor(
    private readonly player: Player,
    private readonly sourceGateTile: TileRef,
    private readonly destinationGateTile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    const playerID = this.player.id();

    // Same source/destination is always invalid.
    if (this.sourceGateTile === this.destinationGateTile) {
      mg.displayMessage(
        "events_display.jump_gate_failed",
        MessageType.JUMP_GATE_FAILED,
        playerID,
        undefined,
        { reason: "Source and destination are the same gate" },
      );
      return;
    }

    // Locate an active, finished gate at the source tile that the player or
    // an ally owns.
    const sourceGate = mg
      .units(UnitType.JumpGate)
      .find(
        (u) =>
          u.tile() === this.sourceGateTile &&
          u.isActive() &&
          !u.isUnderConstruction() &&
          (u.owner() === this.player || u.owner().isFriendly(this.player)),
      );
    if (!sourceGate) {
      mg.displayMessage(
        "events_display.jump_gate_failed",
        MessageType.JUMP_GATE_FAILED,
        playerID,
        undefined,
        { reason: "No usable gate at source" },
      );
      return;
    }

    // Locate an active, finished gate at the destination tile.
    const destGate = mg
      .units(UnitType.JumpGate)
      .find(
        (u) =>
          u.tile() === this.destinationGateTile &&
          u.isActive() &&
          !u.isUnderConstruction() &&
          (u.owner() === this.player || u.owner().isFriendly(this.player)),
      );
    if (!destGate) {
      mg.displayMessage(
        "events_display.jump_gate_failed",
        MessageType.JUMP_GATE_FAILED,
        playerID,
        undefined,
        { reason: "No usable gate at destination" },
      );
      return;
    }

    // Collect all eligible mobile units the player owns at the source tile.
    let moved = 0;
    for (const unitType of TELEPORTABLE_UNIT_TYPES) {
      for (const unit of this.player.units(unitType)) {
        if (unit.tile() === this.sourceGateTile && unit.isActive()) {
          if (JumpGateTravel.teleport(mg, unit, sourceGate, destGate)) {
            moved++;
          }
        }
      }
    }

    mg.displayMessage(
      "events_display.jump_gate_teleport",
      MessageType.JUMP_GATE_TELEPORT,
      playerID,
      undefined,
      { count: moved },
    );
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
