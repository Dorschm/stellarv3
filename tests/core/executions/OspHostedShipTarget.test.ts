// @vitest-environment node
import { BattlecruiserExecution } from "../../../src/core/execution/BattlecruiserExecution";
import { OrbitalStrikePlatformExecution } from "../../../src/core/execution/OrbitalStrikePlatformExecution";
import { PointDefenseArrayExecution } from "../../../src/core/execution/PointDefenseArrayExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

/**
 * Issue #8 regression — a Battlecruiser-hosted Orbital Strike Platform must
 * filter ship targets through `Player.canAttackPlayer`, not just the
 * `isFriendly` half of that check. The `isImmune` arm of `canAttackPlayer`
 * gates spawn-immunity: skipping it lets a hosted OSP open fire on freshly
 * spawned humans/nations, violating the same protection the ground-target
 * path already honors.
 */

const gameID: GameID = "osp_ship_target_game";

let game: Game;
let attacker: Player;
let defender: Player;

beforeEach(async () => {
  game = await setup("big_plains", {
    infiniteCredits: true,
    instantBuild: true,
  });
  // Give the defender a long spawn-immunity window so the LRW cooldown
  // window we measure here lands inside the protected period.
  (game.config() as TestConfig).setSpawnImmunityDuration(1000);

  game.addPlayer(
    new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
  );
  game.addPlayer(
    new PlayerInfo("defender", PlayerType.Human, null, "defender_id"),
  );

  game.addExecution(
    new SpawnExecution(
      gameID,
      game.player("attacker_id").info(),
      game.ref(5, 5),
    ),
    new SpawnExecution(
      gameID,
      game.player("defender_id").info(),
      game.ref(15, 5),
    ),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  attacker = game.player("attacker_id");
  defender = game.player("defender_id");
});

/**
 * Build an OSP hosted on a Battlecruiser owned by `attacker` and return both
 * the cruiser and the slotted OSP unit. The OSP's execution is also
 * registered so `findShipTargetInRange` is exercised on each tick.
 */
function buildHostedOsp(): { cruiser: Unit; osp: Unit } {
  const tile = game.ref(5, 5);
  const cruiser = attacker.buildUnit(UnitType.Battlecruiser, tile, {
    patrolTile: tile,
  });
  game.addExecution(new BattlecruiserExecution(cruiser));
  const osp = attacker.buildUnit(UnitType.OrbitalStrikePlatform, tile, {});
  cruiser.setSlottedStructure(osp);
  game.addExecution(new OrbitalStrikePlatformExecution(osp));
  return { cruiser, osp };
}

describe("Hosted OSP ship targeting respects canAttackPlayer", () => {
  test("does not fire at spawn-immune enemy ship", async () => {
    expect(defender.isImmune()).toBe(true);

    const { osp } = buildHostedOsp();

    // Park an enemy cruiser well within `longRangeWeaponMaxRange`.
    const enemyCruiserTile = game.ref(15, 5);
    const enemyCruiser = defender.buildUnit(
      UnitType.Battlecruiser,
      enemyCruiserTile,
      { patrolTile: enemyCruiserTile },
    );
    game.addExecution(new BattlecruiserExecution(enemyCruiser));

    const healthBefore = enemyCruiser.health();
    executeTicks(game, 20);

    // No LRW fired → no health lost on the immune target.
    expect(enemyCruiser.health()).toBe(healthBefore);
    void osp;
  });

  test("does fire once immunity expires", async () => {
    expect(defender.isImmune()).toBe(true);

    const { osp } = buildHostedOsp();

    const enemyCruiserTile = game.ref(15, 5);
    const enemyCruiser = defender.buildUnit(
      UnitType.Battlecruiser,
      enemyCruiserTile,
      { patrolTile: enemyCruiserTile },
    );
    game.addExecution(new BattlecruiserExecution(enemyCruiser));

    // Drop the immunity window so the gate flips to "can attack".
    (game.config() as TestConfig).setSpawnImmunityDuration(0);
    expect(defender.isImmune()).toBe(false);

    // `infiniteCredits` zeros out unit build cost, but the OSP's LRW
    // shot still deducts `longRangeWeaponShotCost` (100k credits per
    // shot) from the attacker's actual balance. Without seeded credits
    // the OSP never fires and this test asserts vacuously. Top the
    // attacker up so the shot path is exercised.
    attacker.addCredits(10_000_000n);

    const healthBefore = enemyCruiser.health();
    executeTicks(game, 30);

    expect(enemyCruiser.health()).toBeLessThan(healthBefore);
    // Sanity: the slotted OSP is still alive and the hosting cruiser is
    // still ours — otherwise the damage drop would be ambiguous.
    expect(osp.isActive()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bucket C — A hosted OSP must:
//   (a) damage enemy ships,
//   (b) suppress ground targeting (no LRW impact on owned-territory tiles),
//   (c) charge the LRW shot cost AND set the cooldown.
//
// We drive the production `OrbitalStrikePlatformExecution` through real
// ticks rather than duplicating its predicates in test helpers.
// ---------------------------------------------------------------------------

describe("Hosted OSP — ship damage, ground suppression, cost + cooldown", () => {
  test("damages enemy ship, suppresses ground targeting, charges shot cost and arms cooldown", async () => {
    // Disable spawn-immunity so the defender is a legal LRW target.
    (game.config() as TestConfig).setSpawnImmunityDuration(0);
    expect(defender.isImmune()).toBe(false);

    // Suppress every passive credit movement that isn't the LRW shot
    // itself so the exact-deduction assertion below is unambiguous. Two
    // independent debits/credits could otherwise muddy the math:
    //  - `creditAdditionRate` (territory income / Spaceport trickle)
    //  - `battlecruiserUpkeepPerTick` (fleet upkeep drain on the cruiser
    //    owner, charged each tick by `BattlecruiserExecution`)
    // With both stubbed to 0, the only delta on `attacker.credits()`
    // during the test window is `removeCredits(shotCost)` per LRW shot
    // — making `creditsSpent % shotCost === 0n` a strict proof that the
    // production execution actually paid the cost.
    (
      game.config() as unknown as { creditAdditionRate(p: Player): bigint }
    ).creditAdditionRate = () => 0n;
    (
      game.config() as unknown as {
        battlecruiserUpkeepPerTick(p?: Player): bigint;
      }
    ).battlecruiserUpkeepPerTick = () => 0n;

    // Give the defender owned-territory tiles inside hosted-OSP range so we
    // can prove ground targeting is suppressed when the OSP is hosted.
    // (If the hosted path leaked ground targeting in, these tiles would
    // accrue habitability damage via `applyHabitabilityDamage`.)
    const defenderGroundTiles: number[] = [];
    for (let x = 13; x <= 17; x++) {
      for (let y = 3; y <= 7; y++) {
        const t = game.ref(x, y);
        if (game.map().isSector(t)) {
          defender.conquer(t);
          defenderGroundTiles.push(t);
        }
      }
    }
    expect(defenderGroundTiles.length).toBeGreaterThan(0);

    // Snapshot per-tile effective habitability BEFORE the hosted OSP fires.
    // `OrbitalStrikePlatformExecution.applyLrwImpact` is the authoritative
    // ground-damage hook: on the ground branch it calls
    // `sectorMap().applyHabitabilityDamage(targetTile, ...)`, which is the
    // ONLY production code path that decreases `effectiveHabitability` on
    // a sector tile. Habitability does not decay naturally, so any
    // decrement on a defender tile here is unambiguous proof of a
    // ground-target leak through the hosted-vs-ground branch in
    // `maybeFireLongRangeWeapon`.
    const habitabilityBefore = new Map<number, number>();
    for (const t of defenderGroundTiles) {
      habitabilityBefore.set(t, game.sectorMap().effectiveHabitability(t));
    }

    // Construct the hosted OSP via the production executions so cost +
    // cooldown logic runs through `OrbitalStrikePlatformExecution`. We
    // capture the OSP execution explicitly so we can read its public
    // hooks (`lrwReadyAt`, `pendingLrwImpactCount`) directly.
    const cruiserTile = game.ref(5, 5);
    const cruiser = attacker.buildUnit(UnitType.Battlecruiser, cruiserTile, {
      patrolTile: cruiserTile,
    });
    game.addExecution(new BattlecruiserExecution(cruiser));
    const osp = attacker.buildUnit(
      UnitType.OrbitalStrikePlatform,
      cruiserTile,
      {},
    );
    cruiser.setSlottedStructure(osp);
    const ospExec = new OrbitalStrikePlatformExecution(osp);
    game.addExecution(ospExec);

    const enemyCruiserTile = game.ref(15, 5);
    const enemyCruiser = defender.buildUnit(
      UnitType.Battlecruiser,
      enemyCruiserTile,
      { patrolTile: enemyCruiserTile },
    );
    game.addExecution(new BattlecruiserExecution(enemyCruiser));

    const enemyHealthBefore = enemyCruiser.health();

    // Pre-seed the attacker with a known credit balance well above the LRW
    // shot cost so the cost-deduction assertion is unambiguous. With
    // `creditAdditionRate` stubbed at `0n`, the only delta on
    // `attacker.credits()` during the test window is the LRW shot debit.
    const shotCost = game.config().longRangeWeaponShotCost();
    expect(shotCost).toBeGreaterThan(0n);
    attacker.removeCredits(attacker.credits());
    attacker.addCredits(shotCost * 100n);
    const attackerCreditsBefore = attacker.credits();

    // Drive the OSP through a complete fire → flight → impact window. The
    // LRW cooldown is `orbitalStrikeCooldown()` ticks; running just past
    // a single shot is enough to pin the contract.
    const cooldownTicks = game.config().orbitalStrikeCooldown();
    const tickAtSetup = game.ticks();
    executeTicks(game, cooldownTicks + 5);

    // (a) Ship damage: enemy cruiser took flat `lrwShipDamage` per shot.
    // Damage drop must be at least one shot's worth.
    const shipDamage = game.config().lrwShipDamage();
    expect(enemyCruiser.health()).toBeLessThan(enemyHealthBefore);
    expect(enemyHealthBefore - enemyCruiser.health()).toBeGreaterThanOrEqual(
      shipDamage,
    );

    // (b) Ground suppression: the hosted OSP took the ship-target branch.
    // `OrbitalStrikePlatformExecution.maybeFireLongRangeWeapon` uses a
    // ternary on `hostedOnCapShip` — taking the ship branch precludes the
    // ground-target finder from ever being called. We assert that the
    // resolved impact's `targetShip` is the enemy cruiser (read via the
    // private queue) so the ground-vs-ship branch decision is pinned.
    const pending = (
      ospExec as unknown as {
        pendingImpacts: { targetShip?: { id(): number } }[];
      }
    ).pendingImpacts;
    // After cooldown+5 ticks the impact may already have resolved and
    // been popped off the queue; in that case the ship-damage assertion
    // above is the load-bearing proof. If still queued, the targetShip
    // must reference the enemy cruiser (never undefined for a hosted
    // OSP firing at a ship).
    if (pending.length > 0) {
      expect(pending[0].targetShip).toBeDefined();
      expect(pending[0].targetShip!.id()).toBe(enemyCruiser.id());
    }

    // Authoritative ground-side check: every defender-owned tile inside
    // hosted-OSP range must have unchanged effective habitability. A
    // ground-target impact would have called `applyHabitabilityDamage`
    // on at least one of these tiles, decrementing its
    // `effectiveHabitability` — so equal-before-and-after is the
    // strictly observable proof that no ground LRW impact ever landed.
    for (const t of defenderGroundTiles) {
      const before = habitabilityBefore.get(t)!;
      const after = game.sectorMap().effectiveHabitability(t);
      expect(after).toBe(before);
    }

    // (c) Cost charged: with `creditAdditionRate` stubbed to `0n`, the
    // attacker's credits dropped by an exact multiple of
    // `longRangeWeaponShotCost()` — proving the production execution
    // calls `owner.removeCredits(cost)` for each shot rather than just
    // arming the cooldown without paying. Decoupling cost from cooldown
    // is the exact regression this assertion guards.
    const creditsSpent = attackerCreditsBefore - attacker.credits();
    expect(creditsSpent).toBeGreaterThanOrEqual(shotCost);
    expect(creditsSpent % shotCost).toBe(0n);

    // Cooldown armed: `lrwReadyAt()` is in the future relative to the
    // setup tick. `maybeFireLongRangeWeapon` only writes
    // `lrwReadyTick = currentTick + orbitalStrikeCooldown()` after the
    // shot-cost debit succeeds — combined with the explicit cost
    // assertion above, this pins both the debit and the cooldown set.
    expect(ospExec.lrwReadyAt()).toBeGreaterThan(tickAtSetup);
    // Sanity: cooldown should also be at least one full cooldown period
    // in the future relative to the moment the shot fired.
    expect(ospExec.lrwReadyAt()).toBeGreaterThanOrEqual(
      tickAtSetup + cooldownTicks,
    );

    // Sanity: cruiser is still the host. A captured/dead cruiser would
    // confound the test result.
    expect(cruiser.isActive()).toBe(true);
    expect(cruiser.slottedStructure()).toBe(osp);
  });
});

// ---------------------------------------------------------------------------
// Issue #8 regression — a lethal hosted-OSP LRW impact must attribute the
// kill to the firing player. `OrbitalStrikePlatformExecution.applyLrwImpact`
// passes the firing player into `Unit.modifyHealth(delta, attacker)`, which
// forwards it into `Unit.delete(true, destroyer)`. A missing attacker would
// leave the destroyed ship as an unattributed / non-enemy destruction.
// ---------------------------------------------------------------------------

describe("Hosted OSP lethal shot attributes the kill", () => {
  test("destroyed ship records enemy destruction and the firing player as destroyer", async () => {
    (game.config() as TestConfig).setSpawnImmunityDuration(0);
    expect(defender.isImmune()).toBe(false);

    const { osp } = buildHostedOsp();

    const enemyCruiserTile = game.ref(15, 5);
    const enemyCruiser = defender.buildUnit(
      UnitType.Battlecruiser,
      enemyCruiserTile,
      { patrolTile: enemyCruiserTile },
    );
    game.addExecution(new BattlecruiserExecution(enemyCruiser));

    // Pre-damage the enemy cruiser so a single LRW shot is lethal — its
    // remaining health must sit at or below `lrwShipDamage()` without
    // hitting zero (which would delete it early, unattributed).
    const shipDamage = game.config().lrwShipDamage();
    const remaining = Math.max(1, shipDamage - 100);
    enemyCruiser.modifyHealth(remaining - Number(enemyCruiser.health()));
    expect(enemyCruiser.health()).toBeGreaterThan(0n);
    expect(enemyCruiser.health()).toBeLessThanOrEqual(BigInt(shipDamage));

    // Fund the LRW shot cost so the OSP actually fires.
    attacker.addCredits(10_000_000n);

    executeTicks(game, 30);

    // The lethal LRW impact destroyed the ship and attributed the kill.
    expect(enemyCruiser.isActive()).toBe(false);
    expect(enemyCruiser.wasDestroyedByEnemy()).toBe(true);
    expect(enemyCruiser.destroyer()).toBe(attacker);

    // Sanity: the slotted OSP is still ours and alive.
    expect(osp.isActive()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bucket C — Hosted PDA must intercept *from the cruiser tile* (not from
// some ground spawn point). We slot a real PointDefenseArray on a
// Battlecruiser sitting next to the launch site and confirm the PDA's
// production execution shoots down an incoming nuke whose path crosses the
// cruiser's tile.
// ---------------------------------------------------------------------------

describe("Hosted PDA intercepts from the cruiser tile", () => {
  test("PDA slotted on a Battlecruiser intercepts an incoming nuke at the cruiser's position", async () => {
    // Cruiser parked over the defender's spawn point so the PDA is
    // hosted on top of the inbound-nuke trajectory.
    const cruiserTile = game.ref(15, 5);
    const cruiser = defender.buildUnit(UnitType.Battlecruiser, cruiserTile, {
      patrolTile: cruiserTile,
    });
    const pda = defender.buildUnit(UnitType.PointDefenseArray, cruiserTile, {});
    cruiser.setSlottedStructure(pda);
    // Important: the PDA execution must run from the cruiser tile each
    // tick. The targeting system reads `this.pda.tile()` directly, so the
    // hosted cruiser's drift is naturally followed — we still pin the
    // *initial* hosted-tile invariant here.
    expect(pda.tile()).toBe(cruiserTile);

    game.addExecution(new PointDefenseArrayExecution(defender, null, pda));

    // Build an inbound torpedo on the trajectory that passes the
    // cruiser tile. The PDA must engage from that hosted tile.
    const targetTile = game.ref(15, 8);
    const nuke = attacker.buildUnit(
      UnitType.AntimatterTorpedo,
      game.ref(15, 5),
      {
        targetTile,
        trajectory: [
          { tile: game.ref(15, 5), targetable: true },
          { tile: game.ref(15, 6), targetable: true },
          { tile: game.ref(15, 7), targetable: true },
          { tile: game.ref(15, 8), targetable: true },
        ],
      },
    );

    executeTicks(game, 4);

    // Interception contract: the nuke is gone and the PDA is in cooldown
    // (a shot fired) — both must be true together to prove the PDA's
    // missile launched from the hosted cruiser tile.
    expect(nuke.isActive()).toBe(false);
    expect(pda.isInCooldown()).toBe(true);
    // PDA tile is still the cruiser's tile (no host divergence).
    expect(pda.tile()).toBe(cruiser.tile());
  });
});
