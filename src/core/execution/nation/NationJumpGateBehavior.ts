import { Difficulty, Game, Player, Unit, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { boundingBoxCenter, calculateBoundingBoxCenter } from "../../Util";
import { JumpGateTravel } from "../JumpGateExecution";

/**
 * Per-cadence-tick probability (percent) that the behavior recalls a stray
 * cruiser to a threatened gate. Available on all difficulties — even Easy
 * nations should occasionally pull a wandering cruiser home — but scales up
 * sharply. Matches the table in the AI Jump Gate Behaviors spec.
 */
const DEFENSIVE_RECALL_PROBABILITY_BY_DIFFICULTY: Record<Difficulty, number> = {
  [Difficulty.Easy]: 5,
  [Difficulty.Medium]: 25,
  [Difficulty.Hard]: 50,
  [Difficulty.Impossible]: 80,
};

/**
 * Per-cadence-tick probability (percent) that the behavior repositions a
 * cruiser toward an active outgoing attack. Disabled on Easy (0%).
 */
const OFFENSIVE_REPOSITION_PROBABILITY_BY_DIFFICULTY: Record<
  Difficulty,
  number
> = {
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 25,
  [Difficulty.Hard]: 50,
  [Difficulty.Impossible]: 80,
};

/**
 * Per-eligible-shuttle acceptance probability (percent) for forward-deploying
 * an AssaultShuttle through the gate network. Disabled below Hard.
 */
const SHUTTLE_FORWARD_DEPLOY_PROBABILITY_BY_DIFFICULTY: Record<
  Difficulty,
  number
> = {
  [Difficulty.Easy]: 0,
  [Difficulty.Medium]: 0,
  [Difficulty.Hard]: 50,
  [Difficulty.Impossible]: 80,
};

/**
 * Manhattan-distance ring (in tiles) around a threatened gate. A cruiser
 * farther than this is "too far to help on its own" and becomes a defensive
 * recall candidate; an attacker whose territory center lies within this ring
 * of a gate marks that gate as threatened. Scales with difficulty.
 */
const DEFENSIVE_RECALL_RADIUS_BY_DIFFICULTY: Record<Difficulty, number> = {
  [Difficulty.Easy]: 50,
  [Difficulty.Medium]: 75,
  [Difficulty.Hard]: 100,
  [Difficulty.Impossible]: 150,
};

/**
 * Manhattan-distance ring (in tiles) around an outgoing attack's target
 * centroid. A cruiser already inside this ring is close enough to help and is
 * not worth a teleport; only cruisers farther out are reposition candidates.
 */
const OFFENSIVE_REPOSITION_RADIUS = 75;

/**
 * Gate-based teleport tactics for bot nations. Sibling to the other
 * `Nation*Behavior` modules: instantiated by `NationExecution.initializeBehaviors()`
 * and called once per `attackRate` tick, after `AiAttackBehavior.maybeAttack()`
 * so the offensive-reposition trigger sees freshly-added outgoing attacks.
 *
 * Stateless — each call evaluates the current gate network and current mobile
 * units directly. Fires at most one teleport per call, evaluating the three
 * triggers in priority order: defensive recall → offensive reposition →
 * shuttle forward-deploy.
 */
export class NationJumpGateBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  /**
   * Evaluate the three teleport triggers and dispatch at most one direct
   * `JumpGateTravel.teleport(...)` this tick. Returns `true` if a unit was
   * teleported.
   */
  maybeTeleportUnits(): boolean {
    // Gates/cruisers/shuttles cannot exist before players spawn.
    if (this.game.inSpawnPhase()) {
      return false;
    }

    // Behavior is a no-op without a usable source/destination gate pair.
    const gates = JumpGateTravel.availableGatesFor(this.game, this.player);
    if (gates.length < 2) {
      return false;
    }

    const { difficulty } = this.game.config().gameConfig();

    // Trigger 1: defensive recall (all difficulties).
    if (this.tryDefensiveRecall(gates, difficulty)) {
      return true;
    }

    // Trigger 2: offensive reposition (Medium+).
    if (difficulty !== Difficulty.Easy) {
      if (this.tryOffensiveReposition(gates, difficulty)) {
        return true;
      }
    }

    // Trigger 3: AssaultShuttle forward-deploy (Hard+).
    if (
      difficulty === Difficulty.Hard ||
      difficulty === Difficulty.Impossible
    ) {
      if (this.tryShuttleForwardDeploy(gates, difficulty)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Recall a stray cruiser to a gate menaced by an incoming attack. The
   * threatened gate is the one with the largest incoming-attack population
   * within `defensiveRecallRadius`; the candidate cruiser is the active,
   * unengaged Battlecruiser farthest from that gate.
   */
  private tryDefensiveRecall(gates: Unit[], difficulty: Difficulty): boolean {
    const incoming = this.player.incomingAttacks();
    if (incoming.length === 0) {
      return false;
    }

    const radius = DEFENSIVE_RECALL_RADIUS_BY_DIFFICULTY[difficulty];

    // Pre-compute each incoming attacker's territory center. Attackers with
    // no resolvable centroid (e.g. a just-eliminated player still present in
    // `incomingAttacks()`) are dropped — they cannot mark a gate threatened.
    const threats = incoming
      .map((attack) => ({
        population: attack.population(),
        center: this.territoryCenterTile(attack.attacker()),
      }))
      .filter(
        (threat): threat is { population: number; center: TileRef } =>
          threat.center !== null,
      );
    if (threats.length === 0) {
      return false;
    }

    // Score each gate by the population of nearby incoming attacks.
    const threatenedGates = gates.filter(
      (gate) => this.gateThreatScore(gate, threats, radius) > 0,
    );
    if (threatenedGates.length === 0) {
      return false;
    }
    const threatenedGate = this.pickExtremum(
      threatenedGates,
      (gate) => this.gateThreatScore(gate, threats, radius),
      "max",
    );
    if (threatenedGate === null) {
      return false;
    }

    // A cruiser farther than the recall radius cannot help on its own.
    const candidates = this.recallCandidateCruisers(threatenedGate, radius);
    if (candidates.length === 0) {
      return false;
    }

    // Probability gate — bail (without teleporting) if it fails.
    if (
      this.random.nextInt(0, 100) >=
      DEFENSIVE_RECALL_PROBABILITY_BY_DIFFICULTY[difficulty]
    ) {
      return false;
    }

    // Recall the cruiser least able to help — the one farthest from the gate.
    const cruiser = this.pickExtremum(
      candidates,
      (c) => this.game.manhattanDist(c.tile(), threatenedGate.tile()),
      "max",
    );
    if (cruiser === null) {
      return false;
    }

    const sourceGate = this.nearestGate(gates, cruiser.tile());
    if (sourceGate.id() === threatenedGate.id()) {
      return false;
    }

    return JumpGateTravel.teleport(
      this.game,
      cruiser,
      sourceGate,
      threatenedGate,
    );
  }

  /**
   * Reposition a far-flung cruiser toward the bot's largest active outgoing
   * attack, teleporting it to the friendly gate nearest the target's
   * territory centroid.
   */
  private tryOffensiveReposition(
    gates: Unit[],
    difficulty: Difficulty,
  ): boolean {
    // Largest active outgoing attack with a player target (TerraNullius has
    // no territory centroid to aim at).
    let bestAttackPopulation = 0;
    let targetCentroid: TileRef | null = null;
    for (const attack of this.player.outgoingAttacks()) {
      if (!attack.isActive()) continue;
      const target = attack.target();
      if (!target.isPlayer()) continue;
      if (attack.population() <= bestAttackPopulation) continue;
      // Skip targets with no usable centroid — a just-eliminated player can
      // outlive its territory in `outgoingAttacks()` until the attack's own
      // `AttackExecution` cleans it up.
      const centroid = this.territoryCenterTile(target);
      if (centroid === null) continue;
      bestAttackPopulation = attack.population();
      targetCentroid = centroid;
    }
    if (targetCentroid === null) {
      return false;
    }

    const destGate = this.nearestGate(gates, targetCentroid);

    // Cruisers not already near the target are reposition candidates.
    const candidates = this.player
      .units(UnitType.Battlecruiser)
      .filter(
        (cruiser) =>
          cruiser.isActive() &&
          !cruiser.isUnderConstruction() &&
          cruiser.targetUnit() === undefined &&
          this.game.manhattanDist(cruiser.tile(), targetCentroid!) >
            OFFENSIVE_REPOSITION_RADIUS,
      );
    if (candidates.length === 0) {
      return false;
    }

    // Probability gate — bail (without teleporting) if it fails.
    if (
      this.random.nextInt(0, 100) >=
      OFFENSIVE_REPOSITION_PROBABILITY_BY_DIFFICULTY[difficulty]
    ) {
      return false;
    }

    // Pick the cruiser closest to any gate — minimises wasted travel, since
    // the teleport drops it on the destination gate's tile.
    const cruiser = this.pickExtremum(
      candidates,
      (c) => this.distanceToNearestGate(gates, c.tile()),
      "min",
    );
    if (cruiser === null) {
      return false;
    }

    const sourceGate = this.nearestGate(gates, cruiser.tile());
    // No useful teleport if source and destination resolve to the same gate.
    if (sourceGate.id() === destGate.id()) {
      return false;
    }

    return JumpGateTravel.teleport(this.game, cruiser, sourceGate, destGate);
  }

  /**
   * Forward-deploy an AssaultShuttle through the gate network when doing so
   * shortens its remaining trip to its combat target.
   */
  private tryShuttleForwardDeploy(
    gates: Unit[],
    difficulty: Difficulty,
  ): boolean {
    const probability =
      SHUTTLE_FORWARD_DEPLOY_PROBABILITY_BY_DIFFICULTY[difficulty];

    for (const shuttle of this.player.units(UnitType.AssaultShuttle)) {
      if (!shuttle.isActive() || shuttle.retreating()) {
        continue;
      }
      const target = shuttle.targetTile();
      if (target === undefined) {
        continue;
      }

      // Destination gate is the gate nearest the shuttle's target that
      // shares a reachable deep-space component with it. Teleporting onto a
      // gate on an isolated/wrong water component would strand the shuttle:
      // `AssaultShuttleExecution.tick()` routes with the deep-space
      // pathfinder and deletes/refunds the shuttle on `PathStatus.NOT_FOUND`.
      // A "closer" but disconnected gate must never win — so the
      // connectivity guard is applied before the distance check.
      const reachableGates = gates.filter((gate) =>
        this.sharesDeepSpaceComponent(gate.tile(), target),
      );
      if (reachableGates.length === 0) {
        continue;
      }
      const destGate = this.nearestGate(reachableGates, target);
      const sourceCandidates = gates.filter((g) => g.id() !== destGate.id());
      if (sourceCandidates.length === 0) {
        continue;
      }
      const sourceGate = this.nearestGate(sourceCandidates, shuttle.tile());

      // Re-check the 'teleport shortens the trip' condition after the
      // connectivity guard — skip if teleporting would not shorten the
      // remaining trip.
      const currentDist = this.game.manhattanDist(shuttle.tile(), target);
      const teleportedDist = this.game.manhattanDist(destGate.tile(), target);
      if (teleportedDist >= currentDist) {
        continue;
      }

      // Per-eligible-shuttle acceptance probability.
      if (this.random.nextInt(0, 100) >= probability) {
        continue;
      }

      return JumpGateTravel.teleport(this.game, shuttle, sourceGate, destGate);
    }

    return false;
  }

  /**
   * Active, fully-built, unengaged Battlecruisers farther than `radius` from
   * the threatened gate — recalling something already nearby is pointless.
   */
  private recallCandidateCruisers(
    threatenedGate: Unit,
    radius: number,
  ): Unit[] {
    return this.player
      .units(UnitType.Battlecruiser)
      .filter(
        (cruiser) =>
          cruiser.isActive() &&
          !cruiser.isUnderConstruction() &&
          cruiser.targetUnit() === undefined &&
          this.game.manhattanDist(cruiser.tile(), threatenedGate.tile()) >
            radius,
      );
  }

  /**
   * Total incoming-attack population whose attacker territory center lies
   * within `radius` Manhattan distance of `gate`.
   */
  private gateThreatScore(
    gate: Unit,
    threats: { population: number; center: TileRef }[],
    radius: number,
  ): number {
    let score = 0;
    for (const threat of threats) {
      if (this.game.manhattanDist(gate.tile(), threat.center) <= radius) {
        score += threat.population;
      }
    }
    return score;
  }

  /** Gate from `gates` nearest `tile` by Manhattan distance. */
  private nearestGate(gates: Unit[], tile: TileRef): Unit {
    let best = gates[0];
    let bestDist = this.game.manhattanDist(best.tile(), tile);
    for (const gate of gates) {
      const dist = this.game.manhattanDist(gate.tile(), tile);
      if (dist < bestDist) {
        best = gate;
        bestDist = dist;
      }
    }
    return best;
  }

  /** Manhattan distance from `tile` to the nearest gate in `gates`. */
  private distanceToNearestGate(gates: Unit[], tile: TileRef): number {
    let best = Infinity;
    for (const gate of gates) {
      const dist = this.game.manhattanDist(gate.tile(), tile);
      if (dist < best) {
        best = dist;
      }
    }
    return best;
  }

  /**
   * Pick the item with the extreme `score` (max or min), breaking ties
   * deterministically via the inherited `PseudoRandom`.
   */
  private pickExtremum<T>(
    items: T[],
    score: (item: T) => number,
    mode: "max" | "min",
  ): T | null {
    if (items.length === 0) {
      return null;
    }
    let bestScore = mode === "max" ? -Infinity : Infinity;
    for (const item of items) {
      const s = score(item);
      if (mode === "max" ? s > bestScore : s < bestScore) {
        bestScore = s;
      }
    }
    const tied = items.filter((item) => score(item) === bestScore);
    return this.random.randElement(tied);
  }

  /**
   * Tile at the center of `player`'s territory. Uses the largest-cluster
   * bounding box when available, otherwise the bounding box of all border
   * tiles — the same heuristic `AiAttackBehavior` uses.
   *
   * Returns `null` when no center can be resolved. A just-eliminated player
   * can still be referenced by an in-flight `AttackExecution` until that
   * execution cleans up, leaving it with zero border tiles;
   * `calculateBoundingBoxCenter()` then propagates `Infinity/-Infinity`,
   * which would make `game.ref()` throw. Callers must skip such players.
   */
  private territoryCenterTile(player: Player): TileRef | null {
    const cell = player.largestClusterBoundingBox
      ? boundingBoxCenter(player.largestClusterBoundingBox)
      : calculateBoundingBoxCenter(this.game, player.borderTiles());
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return null;
    }
    return this.game.ref(cell.x, cell.y);
  }

  /**
   * Whether tiles `a` and `b` lie on the same reachable deep-space
   * component — the same connectivity check `AssaultShuttleUtils` applies
   * before launching a shuttle. Returns `false` when either tile has no
   * resolvable component.
   */
  private sharesDeepSpaceComponent(a: TileRef, b: TileRef): boolean {
    const ca = this.game.getDeepSpaceComponent(a);
    const cb = this.game.getDeepSpaceComponent(b);
    if (ca === null || cb === null) {
      return false;
    }
    return ca === cb;
  }
}
