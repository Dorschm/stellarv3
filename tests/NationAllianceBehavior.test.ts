import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import {
  AllianceRequest,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Tick,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let requestor: Player;
let allianceBehavior: NationAllianceBehavior;

describe("AllianceBehavior.handleAllianceRequests", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {
      infiniteCredits: true,
      instantBuild: true,
    });

    const playerInfo = new PlayerInfo(
      "player_id",
      PlayerType.Bot,
      null,
      "player_id",
    );
    const requestorInfo = new PlayerInfo(
      "requestor_id",
      PlayerType.Human,
      null,
      "requestor_id",
    );

    game.addPlayer(playerInfo);
    game.addPlayer(requestorInfo);

    player = game.player("player_id");
    requestor = game.player("requestor_id");

    // Use a fixed random seed for deterministic behavior
    const random = new PseudoRandom(46);

    allianceBehavior = new NationAllianceBehavior(
      random,
      game,
      player,
      new NationEmojiBehavior(random, game, player),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  function setupAllianceRequest({
    isTraitor = false,
    relationDelta = 2,
    numTilesPlayer = 10,
    numTilesRequestor = 10,
    alliancesCount = 0,
    createdAtTick = game.ticks() + 1,
  } = {}) {
    if (isTraitor) requestor.markTraitor();

    player.updateRelation(requestor, relationDelta);
    requestor.updateRelation(player, relationDelta);

    game.map().forEachTile((tile) => {
      if (game.map().isSector(tile)) {
        if (numTilesPlayer > 0) {
          player.conquer(tile);
          numTilesPlayer--;
        } else if (numTilesRequestor > 0) {
          requestor.conquer(tile);
          numTilesRequestor--;
        }
      }
    });

    // `startPopulation` is type-keyed: Bot players start at 10k pop and
    // Humans at 100k pop. With the default ratio the human requestor is
    // already > 2.5× the bot's pop, which makes
    // `isAlliancePartnerThreat` short-circuit to `accept` on Medium
    // difficulty BEFORE the relation / alliance-count gates fire. Pin
    // both sides to the same population so the test exercises the
    // intended downstream gates.
    player.setPopulation(100_000);
    requestor.setPopulation(100_000);

    vi.spyOn(player, "alliances").mockReturnValue(new Array(alliancesCount));

    const mockRequest = {
      requestor: () => requestor,
      recipient: () => player,
      createdAt: () => createdAtTick as unknown as Tick,
      accept: vi.fn(),
      reject: vi.fn(),
    } as unknown as AllianceRequest;

    vi.spyOn(player, "incomingAllianceRequests").mockReturnValue([mockRequest]);

    return mockRequest;
  }

  // Acceptance is routed through a reciprocal AllianceRequestExecution so it
  // shares the side effects of the human acceptance path (relation boost,
  // embargo cleanup, in-flight nuke cancellation) — req.accept() is never
  // called directly anymore.
  function expectAccepted(request: AllianceRequest, addExecution: any) {
    expect(addExecution).toHaveBeenCalledWith(
      expect.any(AllianceRequestExecution),
    );
    expect(request.reject).not.toHaveBeenCalled();
  }

  function expectRejected(request: AllianceRequest, addExecution: any) {
    expect(addExecution).not.toHaveBeenCalledWith(
      expect.any(AllianceRequestExecution),
    );
    expect(request.reject).toHaveBeenCalled();
  }

  test("should reject alliance created on first post-spawn tick", () => {
    const cutoff = game.config().numSpawnPhaseTurns() + 1;
    const request = setupAllianceRequest({ createdAtTick: cutoff });
    const addExecution = vi.spyOn(game, "addExecution");

    allianceBehavior.handleAllianceRequests();

    expectRejected(request, addExecution);
  });

  test("should accept alliance when all conditions are met", () => {
    const request = setupAllianceRequest({});
    const addExecution = vi.spyOn(game, "addExecution");

    allianceBehavior.handleAllianceRequests();

    expectAccepted(request, addExecution);
  });

  test("should reject alliance if requestor is a traitor", () => {
    const request = setupAllianceRequest({ isTraitor: true });
    const addExecution = vi.spyOn(game, "addExecution");

    allianceBehavior.handleAllianceRequests();

    expectRejected(request, addExecution);
  });

  test("should reject alliance if relation is hostile", () => {
    const request = setupAllianceRequest({ relationDelta: -2 });
    const addExecution = vi.spyOn(game, "addExecution");

    allianceBehavior.handleAllianceRequests();

    expectRejected(request, addExecution);
  });

  test("should accept alliance if requestor is much larger (> 3 times size of recipient)", () => {
    const request = setupAllianceRequest({
      numTilesRequestor: 40,
    });
    const addExecution = vi.spyOn(game, "addExecution");

    allianceBehavior.handleAllianceRequests();

    expectAccepted(request, addExecution);
  });

  test("should reject alliance if player has too many alliances", () => {
    const request = setupAllianceRequest({ alliancesCount: 10 });
    const addExecution = vi.spyOn(game, "addExecution");

    allianceBehavior.handleAllianceRequests();

    expectRejected(request, addExecution);
  });
});

describe("AllianceBehavior.handleAllianceExtensionRequests", () => {
  let mockGame: any;
  let mockPlayer: any;
  let mockAlliance: any;
  let mockHuman: any;
  let mockRandom: any;
  let allianceBehavior: NationAllianceBehavior;

  beforeEach(() => {
    mockGame = { addExecution: vi.fn() };
    mockHuman = { id: vi.fn(() => "human_id") };
    mockAlliance = {
      onlyOneAgreedToExtend: vi.fn(() => true),
      other: vi.fn(() => mockHuman),
      id: vi.fn(() => 1),
      expiresAt: vi.fn(() => 5000),
    };
    mockRandom = { chance: vi.fn() };

    mockPlayer = {
      alliances: vi.fn(() => [mockAlliance]),
      relation: vi.fn(),
      id: vi.fn(() => "bot_id"),
      type: vi.fn(() => PlayerType.Nation),
    };

    allianceBehavior = new NationAllianceBehavior(
      mockRandom,
      mockGame,
      mockPlayer,
      new NationEmojiBehavior(mockRandom, mockGame, mockPlayer),
    );
  });

  it("should NOT request extension if onlyOneAgreedToExtend is false (no expiration yet or both already agreed)", () => {
    mockAlliance.onlyOneAgreedToExtend.mockReturnValue(false);
    allianceBehavior.handleAllianceExtensionRequests();
    expect(mockGame.addExecution).not.toHaveBeenCalled();
  });

  it("rolls the renewal decision once per request and caches a rejection", () => {
    const decisionSpy = vi
      .spyOn(allianceBehavior as any, "getAllianceDecision")
      .mockReturnValue(false);

    // Re-runs on every AI tick while the request is pending — the decision
    // must not be re-rolled (re-rolling compounds toward acceptance).
    allianceBehavior.handleAllianceExtensionRequests();
    allianceBehavior.handleAllianceExtensionRequests();
    allianceBehavior.handleAllianceExtensionRequests();

    expect(decisionSpy).toHaveBeenCalledTimes(1);
    expect(mockGame.addExecution).not.toHaveBeenCalled();
  });

  it("requests extension when the decision is an acceptance", () => {
    const decisionSpy = vi
      .spyOn(allianceBehavior as any, "getAllianceDecision")
      .mockReturnValue(true);

    allianceBehavior.handleAllianceExtensionRequests();

    expect(decisionSpy).toHaveBeenCalledTimes(1);
    expect(mockGame.addExecution).toHaveBeenCalledTimes(1);
  });

  it("rolls a fresh decision for a new renewal cycle (expiresAt changed)", () => {
    const decisionSpy = vi
      .spyOn(allianceBehavior as any, "getAllianceDecision")
      .mockReturnValue(false);

    allianceBehavior.handleAllianceExtensionRequests();
    // extend() bumps expiresAt, so a later renewal window gets a fresh roll.
    mockAlliance.expiresAt.mockReturnValue(9000);
    allianceBehavior.handleAllianceExtensionRequests();

    expect(decisionSpy).toHaveBeenCalledTimes(2);
  });
});
