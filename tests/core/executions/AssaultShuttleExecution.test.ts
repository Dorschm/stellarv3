// @vitest-environment node
import { AssaultShuttleExecution } from "../../../src/core/execution/AssaultShuttleExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathStatus } from "../../../src/core/pathfinding/types";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { giveSpaceport } from "../../util/utils";

/**
 * GDD §3.2 — AssaultShuttle fleet upkeep.
 *
 * These tests pin the two behaviours called out in the ticket's acceptance
 * criteria:
 *
 *   1. The shuttle's owner loses exactly `assaultShuttleUpkeepPerTick(owner)`
 *      credits every tick the shuttle is active.
 *   2. Bankrupt owners do NOT lose the shuttle — upkeep is strategic
 *      pressure, not a kill switch. `removeCredits` caps at the available
 *      balance, so forcing the owner's balance to 0 repeatedly must leave
 *      the shuttle active.
 *
 * The movement path in AssaultShuttleExecution is not the object under test.
 * We bypass {@link AssaultShuttleExecution.init} and inject just enough state
 * for the upkeep branch at the top of `tick()` to run deterministically,
 * mirroring the pattern in {@link FleetEnhancements.test} (see makeExec there).
 */

const gameID: GameID = "assault_shuttle_upkeep_game";

describe("AssaultShuttleExecution — upkeep drain (GDD §3.2)", () => {
  let game: Game;
  let owner: Player;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteCredits: false,
      instantBuild: true,
    });
    game.addPlayer(
      new PlayerInfo("shuttle_owner", PlayerType.Human, null, "owner_id"),
    );
    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player("owner_id").info(),
        game.ref(5, 5),
      ),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    owner = game.player("owner_id");
  });

  /**
   * Construct an AssaultShuttleExecution with just enough internal state for
   * `tick()` to reach the upkeep branch and then bail out cleanly before the
   * movement path. We set `ticksPerMove` to an absurdly high value so
   * `ticks - lastMove < ticksPerMove` always holds and tick() returns
   * immediately after the upkeep deduction.
   */
  function makeUpkeepExec(): AssaultShuttleExecution {
    const shuttleTile: TileRef = game.ref(5, 5);
    const exec = new AssaultShuttleExecution(owner, shuttleTile, 0);
    (exec as any).mg = game;
    (exec as any).active = true;
    (exec as any).dst = shuttleTile;
    (exec as any).src = shuttleTile;
    (exec as any).lastMove = 0;
    (exec as any).ticksPerMove = 1_000_000;
    (exec as any).target = game.terraNullius();

    const stubShuttle = {
      isActive: () => true,
      owner: () => owner,
      tile: () => shuttleTile,
      move: () => {},
      retreating: () => false,
      targetTile: () => shuttleTile,
      setTargetTile: () => {},
      population: () => 0,
      delete: () => {},
      id: () => 1,
    };
    (exec as any).shuttle = stubShuttle;

    (exec as any).pathFinder = {
      next: () => ({ status: PathStatus.NEXT, node: shuttleTile }),
      findPath: () => [shuttleTile],
    };

    return exec;
  }

  test("drains owner credits by the configured upkeep each tick while active", () => {
    const exec = makeUpkeepExec();

    const upkeep = game.config().assaultShuttleUpkeepPerTick(owner);
    expect(upkeep).toBeGreaterThan(0n);

    // Pin credits to a known, non-zero balance so per-tick drain math is
    // unambiguous. Avoids interference from the free-running game economy
    // by driving the execution's tick() directly rather than via
    // game.executeNextTick().
    owner.removeCredits(owner.credits());
    const STARTING = 1_000_000n;
    owner.addCredits(STARTING);
    expect(owner.credits()).toBe(STARTING);

    const TICKS = 5;
    for (let i = 0; i < TICKS; i++) {
      exec.tick(i);
    }

    expect(owner.credits()).toBe(STARTING - upkeep * BigInt(TICKS));
    // And the execution is still firing — it shouldn't self-deactivate
    // just because upkeep has been charged.
    expect(exec.isActive()).toBe(true);
  });

  test("shuttle stays active when the owner is bankrupt (upkeep is not a kill switch)", () => {
    const exec = makeUpkeepExec();

    // Drain credits before each upkeep deduction so the owner is
    // perpetually at 0. `removeCredits` caps at available balance, so the
    // shuttle must not deactivate despite the owner never being able to
    // pay upkeep.
    owner.removeCredits(owner.credits());
    for (let i = 0; i < 20; i++) {
      owner.removeCredits(owner.credits());
      expect(owner.credits()).toBe(0n);
      exec.tick(i);
      expect(owner.credits()).toBe(0n);
    }

    expect(
      ((exec as any).shuttle as { isActive: () => boolean }).isActive(),
    ).toBe(true);
    expect(exec.isActive()).toBe(true);
  });
});

/**
 * GDD §6 / May 2026 balance pass (#3) — Assault Shuttle travel speed is
 * pinned at one tick per tile so the unit doesn't feel like a slog. This
 * suite pins that timing through the real init()+tick() movement path
 * (not the upkeep stub above, which deliberately injects a huge
 * `ticksPerMove` and so cannot guard against the speed regressing).
 */
describe("AssaultShuttleExecution — movement timing (1 tick/tile)", () => {
  let game: Game;
  let attacker: Player;

  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteCredits: true,
      instantBuild: true,
      infinitePopulation: true,
    });

    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    game.addExecution(
      new SpawnExecution(
        "movement_test_game" as GameID,
        attackerInfo,
        game.ref(0, 10),
      ),
      new SpawnExecution(
        "movement_test_game" as GameID,
        defenderInfo,
        game.ref(0, 15),
      ),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    attacker = game.player("attacker_id");

    // Real Spaceport is required for AssaultShuttleExecution.canBuild.
    giveSpaceport(game, attacker, game.ref(15, 8));
  });

  test("Config.assaultShuttleTicksPerTile() is 1", () => {
    expect(game.config().assaultShuttleTicksPerTile()).toBe(1);
  });

  test("init() records ticksPerMove from Config and the shuttle advances one tile per tick", () => {
    // Use the live config — do NOT inject ticksPerMove. The point of this
    // test is that the production execution wires the 1-tick cadence
    // through Config, not that we can force it via field assignment.
    const exec = new AssaultShuttleExecution(attacker, game.ref(15, 8), 100);
    game.addExecution(exec);
    // First tick processes init(); after that the shuttle exists and
    // ticksPerMove has been resolved.
    game.executeNextTick();

    const ticksPerMove = (exec as unknown as { ticksPerMove: number })
      .ticksPerMove;
    expect(ticksPerMove).toBe(1);
    expect(ticksPerMove).toBe(game.config().assaultShuttleTicksPerTile());

    const shuttles = attacker.units(UnitType.AssaultShuttle);
    expect(shuttles).toHaveLength(1);
    const shuttle = shuttles[0];
    expect(shuttle.isActive()).toBe(true);

    // Step the simulation tile-by-tile and confirm the shuttle's location
    // changes on every tick — i.e. the gate `ticks - lastMove < 1` never
    // holds back movement. We watch a handful of ticks (well under the
    // path length to the (15, 8) target from a (0,10) spawn) so we don't
    // accidentally see the shuttle arrive and self-destruct mid-test.
    let previousTile = shuttle.tile();
    for (let step = 0; step < 4; step++) {
      game.executeNextTick();
      if (!shuttle.isActive()) break;
      const currentTile = shuttle.tile();
      expect(currentTile).not.toBe(previousTile);
      previousTile = currentTile;
    }
  });
});
