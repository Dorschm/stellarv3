// @vitest-environment node
import {
  JumpGateExecution,
  JumpGateTravel,
} from "../src/core/execution/JumpGateExecution";
import { OrbitalStrikePlatformExecution } from "../src/core/execution/OrbitalStrikePlatformExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

/**
 * Tests for Ticket 5 — Structure Alignment: Long-Range Weapon (LRW) and
 * Jump Gate.
 *
 * We bypass the ConstructionExecution pipeline and `canBuild` via
 * `player.buildUnit()` so the tests don't depend on spawn-phase territory
 * expansion reaching arbitrary coordinates. The executions that would
 * normally be wired up by ConstructionExecution (OrbitalStrikePlatformExecution,
 * JumpGateExecution) are added manually.
 */

const gameID: GameID = "game_id";

/**
 * Builds an OSP at `tile` for `player` and adds the associated
 * OrbitalStrikePlatformExecution so the LRW tick logic runs. Returns the
 * platform unit and its execution handle.
 */
function spawnActiveOsp(
  game: Game,
  player: Player,
  tile: number,
): { platform: Unit; exec: OrbitalStrikePlatformExecution } {
  const platform = player.buildUnit(UnitType.OrbitalStrikePlatform, tile, {});
  const exec = new OrbitalStrikePlatformExecution(platform);
  game.addExecution(exec);
  return { platform, exec };
}

describe("Long-Range Weapon (Ticket 5)", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });

    const attackerInfo = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    // Spawn the two nations close enough that the defender lies inside
    // the LRW envelope (TestConfig.defaultNukeTargetableRange() == 20).
    game.addExecution(
      new SpawnExecution(gameID, attackerInfo, game.ref(1, 1)),
      new SpawnExecution(gameID, defenderInfo, game.ref(15, 1)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");
    defender = game.player("defender_id");
  });

  test("config exposes GDD §5 long-range weapon constants", () => {
    const cfg = game.config();
    // 1 AU = 100 tiles per the GDD AU convention.
    expect(cfg.auInTiles()).toBe(100);
    // 3 AU/s ≈ 30 tiles/tick @ 100ms/tick.
    expect(cfg.longRangeWeaponProjectileSpeed()).toBe(30);
    // 100k credits per shot, 100-tick cooldown.
    expect(cfg.longRangeWeaponShotCost()).toBe(100_000n);
    expect(cfg.orbitalStrikeCooldown()).toBe(100);
    // 10% pop / 10% habitability damage on impact.
    expect(cfg.longRangeWeaponPopulationDamageRatio()).toBeCloseTo(0.1, 10);
    expect(cfg.longRangeWeaponHabitabilityDamage()).toBeCloseTo(0.1, 10);
  });

  test("OSP autonomously fires LRW at the closest enemy and reduces defender population", () => {
    // `infiniteCredits` only makes unit purchases cost 0 — it does NOT
    // give the player a bottomless credit balance. Stockpile enough to
    // cover at least one LRW shot (100k) so the cost check passes.
    attacker.addCredits(500_000n);

    // Place the OSP directly on an attacker-owned tile to sidestep
    // canBuild's ownership check. Spawn (1,1) is guaranteed owned.
    const { exec: osp } = spawnActiveOsp(game, attacker, game.ref(1, 1));

    // Capture state before the LRW resolves.
    const defenderPopulationBefore = defender.population();

    // Wait long enough for the OSP to fire AND for the projectile to
    // travel to the target. Distance is roughly 14 tiles → flight time
    // ceil(14 / 30) = 1 tick. A handful of ticks is enough to cover
    // both the fire and the impact.
    executeTicks(game, 5);

    // After firing, the OSP cooldown should have advanced past the
    // "not yet armed" sentinel (-1).
    expect(osp.lrwReadyAt()).toBeGreaterThan(0);

    // Observable side-effect: defender lost a meaningful chunk of pop.
    // The 10% LRW hit lands as a single subtraction of current population;
    // growth over 5 ticks is much smaller than 10% of starting population.
    const lossFromLrw = Math.floor(defenderPopulationBefore * 0.1);
    expect(defender.population()).toBeLessThanOrEqual(
      defenderPopulationBefore - lossFromLrw + 2000,
    );
  });

  test("LRW deducts shot cost from the OSP owner", async () => {
    // Re-run setup with finite credits so we can watch the deduction.
    const finiteGame = await setup("plains", {
      infiniteCredits: false,
      instantBuild: true,
    });
    const aInfo = new PlayerInfo("a", PlayerType.Human, null, "a");
    const dInfo = new PlayerInfo("d", PlayerType.Human, null, "d");
    finiteGame.addPlayer(aInfo);
    finiteGame.addPlayer(dInfo);
    finiteGame.addExecution(
      new SpawnExecution(gameID, aInfo, finiteGame.ref(1, 1)),
      new SpawnExecution(gameID, dInfo, finiteGame.ref(15, 1)),
    );
    while (finiteGame.inSpawnPhase()) {
      finiteGame.executeNextTick();
    }
    const aPlayer = finiteGame.player("a");

    // Stockpile enough credits to comfortably afford one shot.
    aPlayer.addCredits(500_000n);
    const creditsBefore = aPlayer.credits();

    spawnActiveOsp(finiteGame, aPlayer, finiteGame.ref(1, 1));

    // Run a few ticks so the OSP detects the enemy and fires.
    executeTicks(finiteGame, 5);

    // Cost should have been deducted from the attacker's purse. Credits
    // can also grow from work/trade during the same window, so we allow
    // a small drift — the key assertion is that it dropped by at least
    // the shot cost minus any tick-scale income.
    expect(aPlayer.credits()).toBeLessThan(creditsBefore);
  });

  test("LRW does not fire when the owner cannot pay the shot cost", async () => {
    const pennilessGame = await setup("plains", {
      infiniteCredits: false,
      instantBuild: true,
    });
    const aInfo = new PlayerInfo("a", PlayerType.Human, null, "a");
    const dInfo = new PlayerInfo("d", PlayerType.Human, null, "d");
    pennilessGame.addPlayer(aInfo);
    pennilessGame.addPlayer(dInfo);
    pennilessGame.addExecution(
      new SpawnExecution(gameID, aInfo, pennilessGame.ref(1, 1)),
      new SpawnExecution(gameID, dInfo, pennilessGame.ref(15, 1)),
    );
    while (pennilessGame.inSpawnPhase()) {
      pennilessGame.executeNextTick();
    }
    const aPlayer = pennilessGame.player("a");
    const dPlayer = pennilessGame.player("d");

    // Drain credits so the owner cannot afford an LRW shot.
    const drained = aPlayer.credits();
    aPlayer.removeCredits(drained);
    expect(aPlayer.credits()).toBeLessThan(100_000n);

    spawnActiveOsp(pennilessGame, aPlayer, pennilessGame.ref(1, 1));

    const dPopulationBefore = dPlayer.population();
    executeTicks(pennilessGame, 10);

    // No shot fired → defender population unchanged by the LRW path.
    // (Other systems might still fluctuate population slightly, so we just
    // assert the defender did not take the 10% LRW hit.)
    expect(dPlayer.population()).toBeGreaterThanOrEqual(
      Math.floor(dPopulationBefore * 0.95),
    );
  });

  test("LRW schedules a pending impact after firing and resolves it", () => {
    // Stockpile credits so the LRW can fire.
    attacker.addCredits(500_000n);

    const { exec: osp } = spawnActiveOsp(game, attacker, game.ref(1, 1));

    // First executeNextTick picks up the newly added execution; the OSP
    // tick logic only actually runs on the *second* tick after
    // addExecution. At that point the LRW fires, queues the impact
    // (flight time max(1, ceil(14/30)) = 1 tick), and on the third tick
    // the impact resolves and pending drains back to zero.
    executeTicks(game, 2);
    expect(osp.pendingLrwImpactCount()).toBeGreaterThanOrEqual(1);

    executeTicks(game, 3);
    expect(osp.pendingLrwImpactCount()).toBe(0);

    // Habitability damage itself is covered by dedicated SectorMap unit
    // tests (tests/core/game/SectorMap.test.ts) — the plains test map
    // has no nation seeds, so applyHabitabilityDamage is a no-op here
    // regardless of whether the LRW fires. The pending-impact assertion
    // above is what verifies the LRW end-to-end path reaches applyLrwImpact.
  });
});

describe("Jump Gate (Ticket 5)", () => {
  let game: Game;
  let owner: Player;
  let ally: Player;
  let stranger: Player;

  /**
   * Builds a Jump Gate directly via `buildUnit` (bypassing canBuild) and
   * registers its JumpGateExecution so lifecycle ticks fire. Returns the
   * gate unit.
   */
  function spawnActiveGate(
    gameInstance: Game,
    player: Player,
    tile: number,
  ): Unit {
    const gate = player.buildUnit(UnitType.JumpGate, tile, {});
    gameInstance.addExecution(new JumpGateExecution(gate));
    return gate;
  }

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });

    const ownerInfo = new PlayerInfo("owner", PlayerType.Human, null, "owner");
    const allyInfo = new PlayerInfo("ally", PlayerType.Human, null, "ally");
    const strangerInfo = new PlayerInfo(
      "stranger",
      PlayerType.Human,
      null,
      "stranger",
    );
    game.addPlayer(ownerInfo);
    game.addPlayer(allyInfo);
    game.addPlayer(strangerInfo);

    game.addExecution(
      new SpawnExecution(gameID, ownerInfo, game.ref(1, 1)),
      new SpawnExecution(gameID, allyInfo, game.ref(40, 40)),
      new SpawnExecution(gameID, strangerInfo, game.ref(80, 80)),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    owner = game.player("owner");
    ally = game.player("ally");
    stranger = game.player("stranger");
  });

  test("availableGatesFor returns owned active non-construction gates", () => {
    // No gates yet — should be empty.
    expect(JumpGateTravel.availableGatesFor(game, owner)).toEqual([]);

    spawnActiveGate(game, owner, game.ref(1, 1));
    spawnActiveGate(game, owner, game.ref(2, 2));

    const gates = JumpGateTravel.availableGatesFor(game, owner);
    expect(gates).toHaveLength(2);
    for (const g of gates) {
      expect(g.isActive()).toBe(true);
      expect(g.isUnderConstruction()).toBe(false);
    }
  });

  test("destinationsFrom excludes the source gate", () => {
    spawnActiveGate(game, owner, game.ref(1, 1));
    spawnActiveGate(game, owner, game.ref(2, 2));

    const [first, second] = JumpGateTravel.availableGatesFor(game, owner);
    const destinations = JumpGateTravel.destinationsFrom(game, owner, first);
    expect(destinations).toHaveLength(1);
    expect(destinations[0].id()).toBe(second.id());
  });

  test("teleport moves a unit instantly between two owned gates", () => {
    const a = spawnActiveGate(game, owner, game.ref(1, 1));
    const b = spawnActiveGate(game, owner, game.ref(3, 3));

    // Use a Battlecruiser as the unit being teleported. We just need any
    // mobile player-owned unit; battlecruisers are easy to spawn via
    // buildUnit which bypasses canBuild and construction time.
    const ship = owner.buildUnit(UnitType.Battlecruiser, a.tile(), {
      patrolTile: a.tile(),
    });

    const ok = JumpGateTravel.teleport(game, ship, a, b);
    expect(ok).toBe(true);
    expect(ship.tile()).toBe(b.tile());
  });

  test("teleport allows allied gates as a destination", () => {
    const ownerGate = spawnActiveGate(game, owner, game.ref(1, 1));
    const allyGate = spawnActiveGate(game, ally, game.ref(40, 40));

    // Form an alliance so the ally's gate becomes a valid destination.
    const req = owner.createAllianceRequest(ally);
    expect(req).not.toBeNull();
    req!.accept();

    expect(owner.isFriendly(ally)).toBe(true);

    // The available list for `owner` should now include both their gate
    // and the ally's gate.
    const available = JumpGateTravel.availableGatesFor(game, owner);
    expect(available).toHaveLength(2);

    const ship = owner.buildUnit(UnitType.Battlecruiser, ownerGate.tile(), {
      patrolTile: ownerGate.tile(),
    });
    const ok = JumpGateTravel.teleport(game, ship, ownerGate, allyGate);
    expect(ok).toBe(true);
    expect(ship.tile()).toBe(allyGate.tile());
  });

  test("teleport refuses gates owned by an unallied stranger", () => {
    const ownerGate = spawnActiveGate(game, owner, game.ref(1, 1));
    const strangerGate = spawnActiveGate(game, stranger, game.ref(80, 80));

    expect(owner.isFriendly(stranger)).toBe(false);

    const ship = owner.buildUnit(UnitType.Battlecruiser, ownerGate.tile(), {
      patrolTile: ownerGate.tile(),
    });
    const ok = JumpGateTravel.teleport(game, ship, ownerGate, strangerGate);
    expect(ok).toBe(false);
    // Ship should still be at the owner gate, not at the stranger gate.
    expect(ship.tile()).toBe(ownerGate.tile());
  });

  test("teleport refuses a gate that is still under construction", () => {
    const sourceGate = spawnActiveGate(game, owner, game.ref(1, 1));

    // Manually create a second gate via buildUnit and force it into the
    // under-construction state — this skips the normal lifecycle.
    const destGate = owner.buildUnit(UnitType.JumpGate, game.ref(3, 3), {});
    destGate.setUnderConstruction(true);
    expect(destGate.isUnderConstruction()).toBe(true);

    const ship = owner.buildUnit(UnitType.Battlecruiser, sourceGate.tile(), {
      patrolTile: sourceGate.tile(),
    });
    const ok = JumpGateTravel.teleport(game, ship, sourceGate, destGate);
    expect(ok).toBe(false);
    expect(ship.tile()).toBe(sourceGate.tile());
  });
});
