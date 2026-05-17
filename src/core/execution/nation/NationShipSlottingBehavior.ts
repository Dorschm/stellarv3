import { Difficulty, Game, Player, Unit, UnitType } from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { ConstructionExecution } from "../ConstructionExecution";

/**
 * Per-cadence-tick probability (percent) that the behavior attempts to fill an
 * empty Battlecruiser slot. Scales with difficulty so smarter nations keep
 * their fleet outfitted. Matches the table in the AI Ship Slotting spec.
 */
const SLOT_PROBABILITY_BY_DIFFICULTY: Record<Difficulty, number> = {
  [Difficulty.Easy]: 10,
  [Difficulty.Medium]: 25,
  [Difficulty.Hard]: 50,
  [Difficulty.Impossible]: 80,
};

/**
 * When a cruiser is Colony-eligible (sitting in deep space with unowned sector
 * tiles within `battlecruiserTerritoryRadius`), this is the percent chance to
 * slot a Colony rather than an OrbitalStrikePlatform. Easy short-circuits to
 * Colony-only before this table is consulted; Impossible is contextual (favors
 * whichever structure the bot owns fewer of) and also bypasses this table.
 */
const COLONY_PREFERENCE_BY_DIFFICULTY: Record<Difficulty, number> = {
  [Difficulty.Easy]: 100,
  [Difficulty.Medium]: 70,
  [Difficulty.Hard]: 60,
  [Difficulty.Impossible]: 50,
};

/**
 * Slots a Colony or OrbitalStrikePlatform onto one of the nation's empty-slot
 * Battlecruisers. Sibling to the other `Nation*Behavior` modules: instantiated
 * by `NationExecution.initializeBehaviors()` and called once per `attackRate`
 * tick. Dispatches through the existing host-only `ConstructionExecution` path.
 */
export class NationShipSlottingBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  /**
   * Attempt to fill exactly one empty Battlecruiser slot this tick. Returns
   * `true` if a slotting `ConstructionExecution` was dispatched.
   */
  maybeSlotStructureOnEmptyCruiser(): boolean {
    // Cruisers cannot exist before players spawn.
    if (this.game.inSpawnPhase()) {
      return false;
    }

    const { difficulty } = this.game.config().gameConfig();

    // Probability gate by difficulty.
    if (
      this.random.nextInt(0, 100) >= SLOT_PROBABILITY_BY_DIFFICULTY[difficulty]
    ) {
      return false;
    }

    // Find owned, active, fully-built cruisers with an empty slot.
    const candidates = this.player
      .units(UnitType.Battlecruiser)
      .filter(
        (cruiser) =>
          cruiser.isActive() &&
          !cruiser.isUnderConstruction() &&
          cruiser.slottedStructure() === undefined,
      );
    if (candidates.length === 0) {
      return false;
    }

    // Pick one cruiser fairly — this runs every cadence so no priority needed.
    const cruiser = this.random.randElement(candidates);
    const type = this.decideSlotType(cruiser);

    // Guard: never dispatch a disabled or non-hostable structure type.
    if (this.game.config().isUnitDisabled(type)) {
      return false;
    }
    if (!this.game.config().battlecruiserHostableStructures().includes(type)) {
      return false;
    }

    // Guard: check credits up-front so we don't spam HOST_BUILD_REJECTED
    // events — the host-only path would reject anyway.
    const cost = this.game.unitInfo(type).cost(this.game, this.player);
    if (this.player.credits() < cost) {
      return false;
    }

    // Dispatch via the existing host-only construction path. The
    // `hostBattlecruiserId` argument makes ConstructionExecution slot onto
    // this exact cruiser, with no ground-placement fallback.
    this.game.addExecution(
      new ConstructionExecution(
        this.player,
        type,
        cruiser.tile(),
        undefined,
        cruiser.id(),
      ),
    );
    return true;
  }

  /**
   * Choose which structure to slot onto `cruiser`. Prefers Colony when the
   * cruiser is positioned to be a useful mobile sector-claimer, otherwise an
   * OrbitalStrikePlatform. Difficulty shapes the bias per the spec table.
   */
  private decideSlotType(cruiser: Unit): UnitType {
    const { difficulty } = this.game.config().gameConfig();

    // Easy nations only ever slot Colony.
    if (difficulty === Difficulty.Easy) {
      return UnitType.Colony;
    }

    // Without a Colony-claimable frontier nearby, a mobile Colony is wasted —
    // arm the cruiser with an OrbitalStrikePlatform instead.
    if (!this.isColonyEligible(cruiser)) {
      return UnitType.OrbitalStrikePlatform;
    }

    // Impossible: contextual — slot whichever structure the bot owns fewer of.
    if (difficulty === Difficulty.Impossible) {
      const colonies = this.player.units(UnitType.Colony).length;
      const platforms = this.player.units(
        UnitType.OrbitalStrikePlatform,
      ).length;
      if (colonies < platforms) {
        return UnitType.Colony;
      }
      if (platforms < colonies) {
        return UnitType.OrbitalStrikePlatform;
      }
      return this.random.chance(2)
        ? UnitType.Colony
        : UnitType.OrbitalStrikePlatform;
    }

    // Medium/Hard: weighted split favoring Colony when the cruiser is eligible.
    return this.random.nextInt(0, 100) <
      COLONY_PREFERENCE_BY_DIFFICULTY[difficulty]
      ? UnitType.Colony
      : UnitType.OrbitalStrikePlatform;
  }

  /**
   * A cruiser is Colony-eligible when it sits in deep space and has at least
   * one unowned sector tile within `battlecruiserTerritoryRadius` — i.e. it is
   * positioned to claim fresh territory once a Colony is slotted.
   */
  private isColonyEligible(cruiser: Unit): boolean {
    if (!this.game.isDeepSpace(cruiser.tile())) {
      return false;
    }
    const radius = this.game.config().battlecruiserTerritoryRadius();
    const unownedSectors = this.game.circleSearch(
      cruiser.tile(),
      radius,
      (tile) => this.game.isSector(tile) && !this.game.hasOwner(tile),
    );
    return unownedSectors.size > 0;
  }
}
