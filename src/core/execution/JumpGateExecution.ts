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
 * Maximum Manhattan distance (in tiles) between the intent tile and a
 * Battlecruiser-hosted gate's current tile that still counts as "the gate
 * the player meant". Intents travel over the network, so by the time a
 * mass-teleport lands the hosting cruiser may have drifted by a tile.
 * Keeping this conservative (1) avoids collapsing neighbouring gates onto
 * each other.
 */
const GATE_DRIFT_TOLERANCE = 1;

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

    const sourceGate = this.resolveGate(mg, this.sourceGateTile);
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

    // Exclude the resolved source gate so the drift fallback can never
    // collapse both endpoints onto the same surviving gate.
    const destGate = this.resolveGate(mg, this.destinationGateTile, sourceGate);
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

    // Identity guard: even with the exclusion above, belt-and-braces check
    // that the two resolved gates are not the same unit.
    if (sourceGate.id() === destGate.id()) {
      mg.displayMessage(
        "events_display.jump_gate_failed",
        MessageType.JUMP_GATE_FAILED,
        playerID,
        undefined,
        { reason: "Source and destination are the same gate" },
      );
      return;
    }

    // Units are collected at the gate's *current* tile (not the stale intent
    // tile) so drifted ship-hosted gates still sweep the correct tile.
    const resolvedSourceTile = sourceGate.tile();
    let moved = 0;
    for (const unitType of TELEPORTABLE_UNIT_TYPES) {
      for (const unit of this.player.units(unitType)) {
        if (unit.tile() === resolvedSourceTile && unit.isActive()) {
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

  /**
   * Resolve an intent tile to a usable Jump Gate. Prefers an exact tile
   * match; falls back to the closest eligible gate within
   * {@link GATE_DRIFT_TOLERANCE} to tolerate Battlecruiser-hosted gates
   * that moved between intent and execution. When `exclude` is supplied,
   * that gate is filtered from both the exact and drift passes.
   */
  private resolveGate(
    mg: Game,
    intentTile: TileRef,
    exclude?: Unit,
  ): Unit | undefined {
    const usable = (u: Unit): boolean =>
      u.isActive() &&
      !u.isUnderConstruction() &&
      (u.owner() === this.player || u.owner().isFriendly(this.player)) &&
      (exclude === undefined || u.id() !== exclude.id());

    const gates = mg.units(UnitType.JumpGate);
    const exact = gates.find((u) => u.tile() === intentTile && usable(u));
    if (exact) {
      return exact;
    }

    let best: Unit | undefined;
    let bestDist = GATE_DRIFT_TOLERANCE + 1;
    for (const u of gates) {
      if (!usable(u)) continue;
      const d = mg.manhattanDist(intentTile, u.tile());
      if (d <= GATE_DRIFT_TOLERANCE && d < bestDist) {
        best = u;
        bestDist = d;
      }
    }
    return best;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
