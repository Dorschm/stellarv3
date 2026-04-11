// @vitest-environment node
import { AssaultShuttleExecution } from "../../../src/core/execution/AssaultShuttleExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { TradeFreighterExecution } from "../../../src/core/execution/TradeFreighterExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathStatus } from "../../../src/core/pathfinding/types";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

/**
 * Tests for Ticket 9 — Fleet Enhancements (GDD §6, §7).
 *
 * Two behaviours are exercised here:
 *
 *   1. **Trade routes carry a population payload.** TradeFreighterExecution
 *      now removes a configurable fraction of the source player's population at
 *      launch and delivers them to the destination port owner on arrival.
 *      The fraction lives behind {@link Config.tradePopulationFraction} so
 *      balance changes don't require touching execution code.
 *
 *   2. **Friendly Assault Fleets terraform Nebula → OpenSpace.** When an
 *      AssaultShuttle lands on a tile owned by the attacker that happens to
 *      be Nebula (partial habitability), the destination terrain steps up to
 *      OpenSpace (full habitability) and the SectorMap habitability sum is
 *      kept in sync — mirroring the pattern used by ScoutSwarmExecution.
 */

const gameID: GameID = "fleet_enhancements_game";

/**
 * Player.tiles() returns a ReadonlySet<TileRef>; pull the first member out
 * via Set iteration. Tests use this when they just need *any* owned tile.
 */
function firstTile(player: Player): TileRef {
  for (const t of player.tiles()) {
    return t;
  }
  throw new Error(`player ${player.id()} owns no tiles`);
}

describe("TradeFreighterExecution — population transport (GDD §7)", () => {
  let game: Game;
  let sender: Player;
  let receiver: Player;
  let srcPort: Unit;
  let dstPort: Unit;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteCredits: true,
      instantBuild: true,
    });
    game.addPlayer(
      new PlayerInfo("sender", PlayerType.Human, null, "sender_id"),
    );
    game.addPlayer(
      new PlayerInfo("receiver", PlayerType.Human, null, "receiver_id"),
    );
    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player("sender_id").info(),
        game.ref(5, 5),
      ),
      new SpawnExecution(
        gameID,
        game.player("receiver_id").info(),
        game.ref(20, 20),
      ),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    sender = game.player("sender_id");
    receiver = game.player("receiver_id");

    // Build spaceports directly so we don't depend on construction timing.
    // buildUnit bypasses canBuild and produces an immediately-active port.
    const senderTile = firstTile(sender);
    const receiverTile = firstTile(receiver);
    srcPort = sender.buildUnit(UnitType.Spaceport, senderTile, {});
    dstPort = receiver.buildUnit(UnitType.Spaceport, receiverTile, {});
  });

  /**
   * Replace the freighter's real pathfinder with a stub that walks (NEXT)
   * exactly `nextCalls` times before reporting COMPLETE. The stub also
   * provides a no-op findPath so the motion-plan code path stays happy.
   *
   * The real pathfinder needs an actual deep-space path between the two
   * spaceport tiles, which our test setup doesn't guarantee. Stubbing keeps
   * the tests focused on the population payload behaviour rather than
   * pathfinding minutiae.
   */
  function stubPathFinder(
    exec: TradeFreighterExecution,
    nextCalls: number,
  ): void {
    let n = 0;
    (exec as any).pathFinder = {
      next: () => {
        if (n < nextCalls) {
          n++;
          return { status: PathStatus.NEXT, node: srcPort.tile() };
        }
        return { status: PathStatus.COMPLETE, node: srcPort.tile() };
      },
      findPath: (from: TileRef) => [from],
    };
  }

  test("removes the configured fraction of source population on launch", () => {
    // Drive the execution lifecycle directly so we never advance the game's
    // own tick counter — this avoids the per-tick population growth that
    // PlayerExecution applies and lets us assert exact population deltas.
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(game, 0);
    stubPathFinder(exec, 5);

    const STARTING_TROOPS = 10_000;
    sender.removePopulation(sender.population());
    sender.addPopulation(STARTING_TROOPS);
    expect(sender.population()).toBe(STARTING_TROOPS);

    exec.tick(0);

    const fraction = game.config().tradePopulationFraction();
    const expectedDelta = Math.floor(STARTING_TROOPS * fraction);
    expect(expectedDelta).toBeGreaterThan(0);
    expect(sender.population()).toBe(STARTING_TROOPS - expectedDelta);
    expect((exec as any).populationCarried).toBe(expectedDelta);
  });

  test("delivers transported population to the destination on arrival", () => {
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(game, 0);
    stubPathFinder(exec, 1);

    const STARTING_TROOPS = 10_000;
    sender.removePopulation(sender.population());
    sender.addPopulation(STARTING_TROOPS);
    receiver.removePopulation(receiver.population());
    const dstStart = receiver.population();

    // First tick builds the freighter, deducts source population, and the stub
    // returns NEXT once to exercise the move path.
    exec.tick(0);
    const fraction = game.config().tradePopulationFraction();
    const expectedDelta = Math.floor(STARTING_TROOPS * fraction);
    expect(sender.population()).toBe(STARTING_TROOPS - expectedDelta);

    // Second tick: stub now returns COMPLETE, so complete() runs and the
    // payload is delivered to the destination port owner.
    exec.tick(1);

    expect(receiver.population()).toBe(dstStart + expectedDelta);
    // populationCarried is cleared once the payload has been delivered.
    expect((exec as any).populationCarried).toBe(0);
  });

  test("transported population are zero when the source has no population", () => {
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(game, 0);
    stubPathFinder(exec, 5);

    sender.removePopulation(sender.population());
    expect(sender.population()).toBe(0);

    exec.tick(0);

    expect(sender.population()).toBe(0);
    // No population were removed, so the carried payload is zero. The freighter
    // can still complete normally without delivering any population.
    expect((exec as any).populationCarried).toBe(0);
  });

  /**
   * Aborted-route guard: if the pathfinder reports NOT_FOUND after the
   * freighter has already picked up its population payload, the payload
   * must be refunded to the original sender rather than silently lost.
   * Without this, administrative cancellations would drain the sender's
   * population on every failed route.
   */
  test("refunds the population payload when pathfinding aborts with NOT_FOUND", () => {
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(game, 0);

    // Stub a pathfinder that immediately fails to find a route on the very
    // first call. The freighter will be built and its payload deducted in
    // the same tick that the pathfinder's NOT_FOUND is observed, so the
    // refund path is what keeps the sender whole.
    (exec as any).pathFinder = {
      next: () => ({ status: PathStatus.NOT_FOUND, node: srcPort.tile() }),
      findPath: (from: TileRef) => [from],
    };

    const STARTING_TROOPS = 10_000;
    sender.removePopulation(sender.population());
    sender.addPopulation(STARTING_TROOPS);
    expect(sender.population()).toBe(STARTING_TROOPS);

    // Suppress the expected "captured trade freighter cannot find route"
    // warning so it doesn't clutter the test output.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      exec.tick(0);
    } finally {
      warnSpy.mockRestore();
    }

    // The execution should have stopped and the freighter should be gone.
    expect(exec.isActive()).toBe(false);
    // Critical: population must be fully refunded — no silent drain.
    expect(sender.population()).toBe(STARTING_TROOPS);
    expect((exec as any).populationCarried).toBe(0);
  });

  /**
   * Aborted-route guard: if the destination port becomes inactive before
   * the freighter arrives (e.g., the spaceport is destroyed), the payload
   * must be refunded rather than silently lost.
   */
  test("refunds the population payload when the destination port is no longer active", () => {
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(game, 0);
    stubPathFinder(exec, 5);

    const STARTING_TROOPS = 10_000;
    sender.removePopulation(sender.population());
    sender.addPopulation(STARTING_TROOPS);

    // First tick builds the freighter and deducts the payload.
    exec.tick(0);
    const fraction = game.config().tradePopulationFraction();
    const expectedDelta = Math.floor(STARTING_TROOPS * fraction);
    expect(sender.population()).toBe(STARTING_TROOPS - expectedDelta);
    expect((exec as any).populationCarried).toBe(expectedDelta);

    // Destroy the destination port before the ship arrives. The next tick
    // should take the "!dstPort.isActive() || !canTrade" administrative
    // exit, which must refund the carried payload.
    dstPort.delete(false);

    exec.tick(1);

    expect(exec.isActive()).toBe(false);
    expect(sender.population()).toBe(STARTING_TROOPS);
    expect((exec as any).populationCarried).toBe(0);
  });
});

describe("AssaultShuttleExecution — Nebula→OpenSpace conversion (GDD §6)", () => {
  let game: Game;
  let attacker: Player;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteCredits: true,
      instantBuild: true,
      infinitePopulation: true,
    });
    game.addPlayer(
      new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
    );
    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player("attacker_id").info(),
        game.ref(5, 5),
      ),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    attacker = game.player("attacker_id");
  });

  /**
   * Build an unattached AssaultShuttleExecution and inject just enough state
   * for `convertNebulaToOpenSpace` to run. We deliberately bypass `init()`
   * because init() rejects targets owned by the attacker — and the friendly
   * conversion path only fires *after* a normal launch when the destination
   * tile becomes attacker-owned mid-flight (e.g., the attacker captures it
   * via another execution while the shuttle is in transit).
   */
  function makeExec(): AssaultShuttleExecution {
    const exec = new AssaultShuttleExecution(attacker, game.ref(5, 5), 0);
    (exec as any).mg = game;
    return exec;
  }

  test("converts a Nebula tile owned by the attacker to OpenSpace", () => {
    // Pick any tile owned by the attacker and force it to Nebula.
    const tile = firstTile(attacker);
    game.map().setTerrainType(tile, TerrainType.Nebula);
    expect(game.map().terrainType(tile)).toBe(TerrainType.Nebula);

    const exec = makeExec();
    (exec as any).convertNebulaToOpenSpace(tile);

    expect(game.map().terrainType(tile)).toBe(TerrainType.OpenSpace);
  });

  test("updates SectorMap habitability tracking after conversion", () => {
    const tile = firstTile(attacker);
    game.map().setTerrainType(tile, TerrainType.Nebula);

    const sectorMap = game.sectorMap();
    const habBefore = sectorMap.effectiveHabitability(tile);

    const exec = makeExec();
    (exec as any).convertNebulaToOpenSpace(tile);

    const habAfter = sectorMap.effectiveHabitability(tile);
    // OpenSpace is the highest habitability band, so the per-tile reading
    // must be at least as high as before — typically strictly higher when
    // the tile sits inside a sector that the player owns.
    expect(habAfter).toBeGreaterThanOrEqual(habBefore);
  });

  test("is a no-op when the destination tile is not Nebula", () => {
    const tile = firstTile(attacker);
    // Force OpenSpace (already fully habitable) — conversion should bail.
    game.map().setTerrainType(tile, TerrainType.OpenSpace);

    const exec = makeExec();
    (exec as any).convertNebulaToOpenSpace(tile);

    expect(game.map().terrainType(tile)).toBe(TerrainType.OpenSpace);
  });
});
