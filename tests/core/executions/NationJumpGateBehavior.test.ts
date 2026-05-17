// @vitest-environment node
import { vi } from "vitest";
import { JumpGateTravel } from "../../../src/core/execution/JumpGateExecution";
import { NationJumpGateBehavior } from "../../../src/core/execution/nation/NationJumpGateBehavior";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Attack,
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

/**
 * Focused coverage for `NationJumpGateBehavior` — the nation-AI module that
 * fires gate teleports. These tests pin two correctness guards added by the
 * AI jump-gate ticket:
 *
 *  1. Shuttle forward-deploy must respect deep-space component connectivity.
 *     A gate that looks "closer" to the shuttle target but sits on a
 *     disconnected water component would strand the shuttle —
 *     `AssaultShuttleExecution.tick()` deletes/refunds it on a path failure.
 *  2. `territoryCenterTile()` must tolerate players with no border tiles. An
 *     attack can briefly outlive the territory of a just-eliminated player it
 *     references, and the centroid lookup would otherwise throw.
 */

const gameID: GameID = "nation_jump_gate_game";

let game: Game;
let nationPlayer: Player;

/**
 * Build a game with a single Nation-type player, spawned and drained past
 * the spawn phase so the behavior's `inSpawnPhase()` short-circuit no longer
 * applies.
 */
async function buildGame(difficulty: Difficulty): Promise<void> {
  game = await setup("big_plains", {
    difficulty,
    infiniteCredits: true,
    instantBuild: true,
  });
  game.addPlayer(
    new PlayerInfo(
      "nation alpha",
      PlayerType.Nation,
      "nation-client",
      "nation",
    ),
  );
  game.addExecution(
    new SpawnExecution(gameID, game.player("nation").info(), game.ref(5, 5)),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  nationPlayer = game.player("nation");
  nationPlayer.addCredits(5_000_000n);
}

/**
 * A `PseudoRandom` whose `nextInt` always returns 0 so every difficulty
 * probability gate passes (`0 >= threshold` is false).
 */
function makeRandom(): PseudoRandom {
  const random = new PseudoRandom(0);
  vi.spyOn(random, "nextInt").mockReturnValue(0);
  return random;
}

function makeBehavior(): NationJumpGateBehavior {
  return new NationJumpGateBehavior(makeRandom(), game, nationPlayer);
}

/** Owned, active, fully-built Jump Gate (instantBuild keeps it non-pending). */
function spawnGate(tile: TileRef): Unit {
  return nationPlayer.buildUnit(UnitType.JumpGate, tile, {});
}

/**
 * Force `getDeepSpaceComponent` to resolve specific tiles to specific
 * components. Tiles not in the map resolve to `null` (no component) — the
 * same "unresolvable" signal the real implementation uses.
 */
function stubDeepSpaceComponents(byTile: Map<TileRef, number>): void {
  vi.spyOn(game, "getDeepSpaceComponent").mockImplementation(
    (tile: TileRef) => byTile.get(tile) ?? null,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NationJumpGateBehavior — shuttle forward-deploy connectivity guard", () => {
  test("teleports to a connected gate instead of a closer disconnected one", async () => {
    await buildGame(Difficulty.Hard);

    const target = game.ref(30, 30);
    // Gate nearest the target by Manhattan distance, but on a different
    // (disconnected) deep-space component — teleporting here would strand
    // the shuttle. The behavior must reject it.
    const disconnectedGate = spawnGate(game.ref(28, 28));
    // Farther from the target, yet on the same component — the only safe
    // forward-deploy destination, and it still shortens the trip.
    const connectedGate = spawnGate(game.ref(12, 12));

    const shuttle = nationPlayer.buildUnit(
      UnitType.AssaultShuttle,
      game.ref(5, 5),
      { population: 100, targetTile: target },
    );

    stubDeepSpaceComponents(
      new Map<TileRef, number>([
        [target, 1],
        [connectedGate.tile(), 1],
        [disconnectedGate.tile(), 2],
      ]),
    );

    expect(makeBehavior().maybeTeleportUnits()).toBe(true);
    // Landed on the connected gate, NOT the closer disconnected one.
    expect(shuttle.tile()).toBe(connectedGate.tile());
    expect(shuttle.tile()).not.toBe(disconnectedGate.tile());
  });

  test("does not teleport when every gate is on a disconnected component", async () => {
    await buildGame(Difficulty.Hard);

    const target = game.ref(30, 30);
    const gateA = spawnGate(game.ref(28, 28));
    const gateB = spawnGate(game.ref(12, 12));
    const shuttleTile = game.ref(5, 5);
    const shuttle = nationPlayer.buildUnit(
      UnitType.AssaultShuttle,
      shuttleTile,
      { population: 100, targetTile: target },
    );

    // Target on component 1; both gates on component 2 — no reachable gate.
    stubDeepSpaceComponents(
      new Map<TileRef, number>([
        [target, 1],
        [gateA.tile(), 2],
        [gateB.tile(), 2],
      ]),
    );

    const teleportSpy = vi.spyOn(JumpGateTravel, "teleport");

    expect(makeBehavior().maybeTeleportUnits()).toBe(false);
    expect(teleportSpy).not.toHaveBeenCalled();
    // Shuttle stayed put — no stranding teleport occurred.
    expect(shuttle.tile()).toBe(shuttleTile);
  });
});

describe("NationJumpGateBehavior — territory centroid resilience", () => {
  /**
   * Add a Nation player but never spawn it, so it owns no tiles and has
   * zero border tiles — the state a just-eliminated player is briefly in
   * while an `AttackExecution` still references it.
   */
  function addBorderlessPlayer(): Player {
    const ghost = game.addPlayer(
      new PlayerInfo("ghost", PlayerType.Nation, "ghost-client", "ghost"),
    );
    expect(ghost.borderTiles().size).toBe(0);
    // Unspawned player has no cluster box — falsy, so `territoryCenterTile`
    // falls through to the border-tile bounding box (which is empty).
    expect(ghost.largestClusterBoundingBox).toBeFalsy();
    return ghost;
  }

  test("defensive recall skips an incoming attack from a borderless attacker", async () => {
    await buildGame(Difficulty.Hard);
    // Two gates so `maybeTeleportUnits` proceeds past its gate-count guard.
    spawnGate(game.ref(28, 28));
    spawnGate(game.ref(12, 12));

    const ghost = addBorderlessPlayer();
    const fakeAttack = {
      population: () => 5000,
      attacker: () => ghost,
      target: () => nationPlayer,
      isActive: () => true,
    } as unknown as Attack;
    vi.spyOn(nationPlayer, "incomingAttacks").mockReturnValue([fakeAttack]);

    // The centroid lookup for the borderless attacker must not throw; the
    // behavior simply finds no threatened gate and bails.
    let result: boolean | undefined;
    expect(() => {
      result = makeBehavior().maybeTeleportUnits();
    }).not.toThrow();
    expect(result).toBe(false);
  });

  test("offensive reposition skips an outgoing attack on a borderless target", async () => {
    await buildGame(Difficulty.Hard);
    spawnGate(game.ref(28, 28));
    spawnGate(game.ref(12, 12));

    const ghost = addBorderlessPlayer();
    const fakeAttack = {
      population: () => 5000,
      attacker: () => nationPlayer,
      target: () => ghost,
      isActive: () => true,
    } as unknown as Attack;
    vi.spyOn(nationPlayer, "outgoingAttacks").mockReturnValue([fakeAttack]);

    let result: boolean | undefined;
    expect(() => {
      result = makeBehavior().maybeTeleportUnits();
    }).not.toThrow();
    expect(result).toBe(false);
  });
});
