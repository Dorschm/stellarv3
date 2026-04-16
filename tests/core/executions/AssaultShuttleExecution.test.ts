// @vitest-environment node
import { AssaultShuttleExecution } from "../../../src/core/execution/AssaultShuttleExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathStatus } from "../../../src/core/pathfinding/types";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

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
