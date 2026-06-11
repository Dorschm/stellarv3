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
 * Regression tests for two AssaultShuttle landing bugs:
 *
 *   1. A shuttle arriving on attacker-owned territory was charged the 25%
 *      retreat malus even when no retreat was ever ordered (e.g. the
 *      attacker's own ground push captured the destination mid-flight).
 *      The malus must only apply to an ordered retreat.
 *
 *   2. A shuttle landing on a tile whose owner became FRIENDLY while the
 *      shuttle was in flight conquered the ally's tile before the friendly
 *      check ran — the only alliance bypass for territory transfer.
 *
 * The movement path is not under test; like the upkeep suite in
 * AssaultShuttleExecution.test.ts we inject just enough state for tick()
 * to reach the PathStatus.COMPLETE landing branch deterministically.
 */

const gameID: GameID = "shuttle_landing_regression";

describe("AssaultShuttleExecution — landing semantics", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteCredits: false,
      instantBuild: true,
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
      new SpawnExecution(gameID, attackerInfo, game.ref(5, 5)),
      new SpawnExecution(gameID, defenderInfo, game.ref(40, 40)),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    attacker = game.player("attacker_id");
    defender = game.player("defender_id");
  });

  /**
   * Construct an AssaultShuttleExecution with injected state so a single
   * tick() call lands the shuttle at `dst` via PathStatus.COMPLETE.
   */
  function makeLandingExec(
    dst: TileRef,
    population: number,
    retreating: boolean,
  ): AssaultShuttleExecution {
    const exec = new AssaultShuttleExecution(attacker, dst, population);
    (exec as any).mg = game;
    (exec as any).active = true;
    (exec as any).dst = dst;
    (exec as any).src = dst;
    (exec as any).lastMove = -10;
    (exec as any).ticksPerMove = 1;
    (exec as any).target = defender;
    // Pre-resolve the retreat destination so the retreat branch doesn't
    // need a real spaceport via bestShuttleSpawn().
    (exec as any).retreatDst = retreating ? dst : null;
    (exec as any).motionPlanDst = dst;

    (exec as any).shuttle = {
      isActive: () => true,
      owner: () => attacker,
      tile: () => dst,
      move: () => {},
      retreating: () => retreating,
      targetTile: () => dst,
      setTargetTile: () => {},
      population: () => population,
      delete: () => {},
      id: () => 1,
    };
    (exec as any).pathFinder = {
      next: () => ({ status: PathStatus.COMPLETE }),
      findPath: () => [dst],
    };
    return exec;
  }

  test("landing on own territory without an ordered retreat delivers full population", () => {
    const dst = game.ref(5, 5); // attacker-owned spawn tile
    expect(game.owner(dst)).toBe(attacker);

    const exec = makeLandingExec(dst, 1000, false);
    const popBefore = attacker.population();
    exec.tick(0);

    // No retreat was ordered — no 25% malus, all 1000 troops return.
    expect(attacker.population()).toBe(popBefore + 1000);
    expect(exec.isActive()).toBe(false);
  });

  test("landing on own territory after an ordered retreat still pays the 25% malus", () => {
    const dst = game.ref(5, 5);
    expect(game.owner(dst)).toBe(attacker);

    const exec = makeLandingExec(dst, 1000, true);
    const popBefore = attacker.population();
    exec.tick(0);

    // Ordered retreat: 25% of 1000 dies, 750 survive.
    expect(attacker.population()).toBe(popBefore + 750);
    expect(exec.isActive()).toBe(false);
  });

  test("landing on a tile owned by a now-friendly player does not conquer it", () => {
    // Ally the two players mid-flight.
    const request = attacker.createAllianceRequest(defender);
    expect(request).not.toBeNull();
    request!.accept();
    expect(attacker.isFriendly(defender)).toBe(true);

    const dst = game.ref(40, 40); // defender-owned spawn tile
    expect(game.owner(dst)).toBe(defender);

    const exec = makeLandingExec(dst, 1000, false);
    const popBefore = attacker.population();
    exec.tick(0);

    // The ally keeps the tile; the attacker gets the troops back in full.
    expect(game.owner(dst)).toBe(defender);
    expect(attacker.population()).toBe(popBefore + 1000);
    expect(exec.isActive()).toBe(false);
  });

  test("landing on a hostile tile still conquers the beachhead", () => {
    const dst = game.ref(40, 40);
    expect(game.owner(dst)).toBe(defender);

    const exec = makeLandingExec(dst, 1000, false);
    exec.tick(0);

    expect(game.owner(dst)).toBe(attacker);
    expect(exec.isActive()).toBe(false);
  });
});
