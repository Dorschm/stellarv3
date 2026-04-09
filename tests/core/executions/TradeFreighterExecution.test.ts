import { TradeFreighterExecution } from "../../../src/core/execution/TradeFreighterExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";
import { PathStatus } from "../../../src/core/pathfinding/types";
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
      addGold: vi.fn(),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      id: vi.fn(() => 1),
      clientID: vi.fn(() => 1),
      canTrade: vi.fn(() => true),
    } as any;

    dstOwner = {
      id: vi.fn(() => 2),
      addGold: vi.fn(),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [dstPort]),
      unitCount: vi.fn(() => 1),
      clientID: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
    } as any;

    pirate = {
      id: vi.fn(() => 3),
      addGold: vi.fn(),
      displayName: vi.fn(() => "Destination"),
      units: vi.fn(() => [piratePort, piratePort2]),
      unitCount: vi.fn(() => 2),
      canTrade: vi.fn(() => true),
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

  it("should complete trade and award gold", () => {
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
