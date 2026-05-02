// @vitest-environment node
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { TradeFreighterExecution } from "../../../src/core/execution/TradeFreighterExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathStatus } from "../../../src/core/pathfinding/types";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

describe("TradeFreighterExecution", () => {
  let game: Game;
  let origOwner: Player;
  let dstOwner: Player;
  let pirate: Player;
  let srcPort: Unit;
  let piratePort: Unit;
  let piratePort2: Unit;
  let tradeFreighter: Unit;
  let dstPort: Unit;
  let tradeFreighterExecution: TradeFreighterExecution;

  beforeEach(async () => {
    // Mock Game, Player, Unit, and required methods

    game = await setup("ocean_and_land", {
      infiniteCredits: true,
      instantBuild: true,
    });
    game.displayMessage = vi.fn();
    origOwner = {
      canBuild: vi.fn(() => true),
      buildUnit: vi.fn((type, spawn, opts) => tradeFreighter),
      displayName: vi.fn(() => "Origin"),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      id: vi.fn(() => 1),
      clientID: vi.fn(() => 1),
      canTrade: vi.fn(() => true),
      type: vi.fn(() => PlayerType.Human),
      removeCredits: vi.fn(),
      addCredits: vi.fn(),
      population: vi.fn(() => 0),
      removePopulation: vi.fn(() => 0),
      addPopulation: vi.fn(),
    } as any;

    dstOwner = {
      id: vi.fn(() => 2),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      clientID: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
      type: vi.fn(() => PlayerType.Human),
      removeCredits: vi.fn(),
      addCredits: vi.fn(),
      addPopulation: vi.fn(),
    } as any;

    pirate = {
      id: vi.fn(() => 3),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [piratePort, piratePort2]),
      unitCount: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
      type: vi.fn(() => PlayerType.Human),
      removeCredits: vi.fn(),
      addCredits: vi.fn(),
      addPopulation: vi.fn(),
    } as any;

    piratePort = {
      tile: vi.fn(() => 56),
      owner: vi.fn(() => pirate),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    piratePort2 = {
      tile: vi.fn(() => 75),
      owner: vi.fn(() => pirate),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    srcPort = {
      tile: vi.fn(() => 10),
      owner: vi.fn(() => origOwner),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    dstPort = {
      tile: vi.fn(() => 100),
      owner: vi.fn(() => dstOwner),
      isActive: vi.fn(() => true),
      isUnderConstruction: vi.fn(() => false),
      isMarkedForDeletion: vi.fn(() => false),
    } as any;

    tradeFreighter = {
      isActive: vi.fn(() => true),
      owner: vi.fn(() => origOwner),
      id: vi.fn(() => 123),
      move: vi.fn(),
      setTargetUnit: vi.fn(),
      setSafeFromPirates: vi.fn(),
      touch: vi.fn(),
      delete: vi.fn(),
      tile: vi.fn(() => 32),
    } as any;

    tradeFreighterExecution = new TradeFreighterExecution(
      origOwner,
      srcPort,
      dstPort,
    );
    tradeFreighterExecution.init(game, 0);
    tradeFreighterExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.NEXT, node: 32 })),
      findPath: vi.fn((from: number) => [from]),
    } as any;
    tradeFreighterExecution["tradeFreighter"] = tradeFreighter;
  });

  it("should initialize and tick without errors", () => {
    tradeFreighterExecution.tick(1);
    expect(tradeFreighterExecution.isActive()).toBe(true);
  });

  it("should deactivate if tradeFreighter is not active", () => {
    tradeFreighter.isActive = vi.fn(() => false);
    tradeFreighterExecution.tick(1);
    expect(tradeFreighterExecution.isActive()).toBe(false);
  });

  it("should NOT charge upkeep when tradeFreighter is already inactive on tick", () => {
    // Comment 2 regression: a freighter destroyed earlier in the tick
    // order previously paid one last upkeep drain before the execution
    // deactivated itself. Upkeep is now gated behind the active-state
    // check, so an inactive freighter must not touch the owner's credits.
    tradeFreighter.isActive = vi.fn(() => false);
    const removeCredits = vi.fn();
    tradeFreighter.owner = vi.fn(
      () =>
        ({
          removeCredits,
          id: () => 1,
        }) as any,
    );

    tradeFreighterExecution.tick(1);

    expect(removeCredits).not.toHaveBeenCalled();
    expect(tradeFreighterExecution.isActive()).toBe(false);
  });

  it("should delete ship if port owner changes to current owner", () => {
    dstPort.owner = vi.fn(() => origOwner);
    tradeFreighterExecution.tick(1);
    expect(tradeFreighter.delete).toHaveBeenCalledWith(false);
    expect(tradeFreighterExecution.isActive()).toBe(false);
  });

  it("should pick another port if ship is captured", () => {
    tradeFreighter.owner = vi.fn(() => pirate);
    tradeFreighterExecution.tick(1);
    expect(tradeFreighter.setTargetUnit).toHaveBeenCalledWith(piratePort);
  });

  it("should complete trade and award credits", () => {
    tradeFreighterExecution["pathFinder"] = {
      next: vi.fn(() => ({ status: PathStatus.COMPLETE, node: 32 })),
      findPath: vi.fn((from: number) => [from]),
    } as any;
    tradeFreighterExecution.tick(1);
    expect(tradeFreighter.delete).toHaveBeenCalledWith(false);
    expect(tradeFreighterExecution.isActive()).toBe(false);
    expect(game.displayMessage).toHaveBeenCalled();
  });
});

/**
 * GDD §3.2 — TradeFreighter fleet upkeep.
 *
 * Steady-state per-tick credit drain and bankruptcy survival for an ACTIVE
 * trade freighter (the mock-heavy suite above already covers the inactive
 * edge case). These tests use a real game and real player so the owner's
 * credits are exercised end-to-end, and stub the pathfinder with a
 * never-complete NEXT so the freighter stays in flight indefinitely.
 */
describe("TradeFreighterExecution — upkeep drain (GDD §3.2)", () => {
  const gameID: GameID = "trade_freighter_upkeep_game";

  let upkeepGame: Game;
  let sender: Player;
  let receiver: Player;
  let srcPort: Unit;
  let dstPort: Unit;

  /**
   * Player.tiles() returns a ReadonlySet<TileRef>; grab the first member
   * so we can drop a Spaceport on real owned ground.
   */
  function firstTile(player: Player): TileRef {
    for (const t of player.tiles()) {
      return t;
    }
    throw new Error(`player ${player.id()} owns no tiles`);
  }

  beforeEach(async () => {
    upkeepGame = await setup("plains", {
      infiniteCredits: false,
      instantBuild: true,
      infinitePopulation: true,
    });
    upkeepGame.addPlayer(
      new PlayerInfo("sender", PlayerType.Human, null, "sender_id"),
    );
    upkeepGame.addPlayer(
      new PlayerInfo("receiver", PlayerType.Human, null, "receiver_id"),
    );
    upkeepGame.addExecution(
      new SpawnExecution(
        gameID,
        upkeepGame.player("sender_id").info(),
        upkeepGame.ref(5, 5),
      ),
      new SpawnExecution(
        gameID,
        upkeepGame.player("receiver_id").info(),
        upkeepGame.ref(20, 20),
      ),
    );
    while (upkeepGame.inSpawnPhase()) {
      upkeepGame.executeNextTick();
    }
    sender = upkeepGame.player("sender_id");
    receiver = upkeepGame.player("receiver_id");

    const senderTile = firstTile(sender);
    const receiverTile = firstTile(receiver);
    srcPort = sender.buildUnit(UnitType.Spaceport, senderTile, {});
    dstPort = receiver.buildUnit(UnitType.Spaceport, receiverTile, {});
  });

  /**
   * Install a pathfinder that always returns NEXT so the freighter never
   * completes — keeps the execution alive so multiple ticks of upkeep can
   * be observed without the trade finishing and deleting the unit.
   */
  function stubNeverCompletePathFinder(exec: TradeFreighterExecution): void {
    (exec as any).pathFinder = {
      next: () => ({ status: PathStatus.NEXT, node: srcPort.tile() }),
      findPath: (from: TileRef) => [from],
    };
  }

  test("drains owner credits by the configured upkeep each tick while active", () => {
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(upkeepGame, 0);
    stubNeverCompletePathFinder(exec);

    // First tick builds the freighter, and the post-build upkeep branch
    // still fires in the same tick. Run that warm-up tick first so the
    // balance math for the steady-state measurement below is unambiguous.
    sender.removeCredits(sender.credits());
    sender.addCredits(10_000_000n);
    exec.tick(0);

    const upkeep = upkeepGame.config().tradeFreighterUpkeepPerTick(sender);
    expect(upkeep).toBeGreaterThan(0n);

    const ownerBefore = sender.credits();
    const TICKS = 5;
    for (let i = 1; i <= TICKS; i++) {
      exec.tick(i);
    }

    expect(sender.credits()).toBe(ownerBefore - upkeep * BigInt(TICKS));
    expect(exec.isActive()).toBe(true);
  });

  test("freighter stays active when the owner is bankrupt (upkeep is not a kill switch)", () => {
    const exec = new TradeFreighterExecution(sender, srcPort, dstPort);
    exec.init(upkeepGame, 0);
    stubNeverCompletePathFinder(exec);

    // Force bankruptcy both before and after every tick so `removeCredits`
    // never has a balance to draw from. The freighter should remain active
    // despite the owner never being able to pay upkeep — this is the
    // GDD §3.2 "not a kill switch" contract.
    sender.removeCredits(sender.credits());
    for (let i = 0; i < 20; i++) {
      sender.removeCredits(sender.credits());
      expect(sender.credits()).toBe(0n);
      exec.tick(i);
      sender.removeCredits(sender.credits());
      expect(sender.credits()).toBe(0n);
    }

    const freighter = (exec as any).tradeFreighter as Unit;
    expect(freighter.isActive()).toBe(true);
    expect(exec.isActive()).toBe(true);
  });
});
