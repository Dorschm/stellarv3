import { WinCheckExecution } from "../../../src/core/execution/WinCheckExecution";
import {
  ColoredTeams,
  GameMode,
  PlayerInfo,
  PlayerType,
  RankedType,
  WinCondition,
} from "../../../src/core/game/Game";
import { playerInfo, setup } from "../../util/Setup";

describe("WinCheckExecution", () => {
  let mg: any;
  let winCheck: WinCheckExecution;

  beforeEach(async () => {
    mg = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      maxTimerValue: 5,
      instantBuild: true,
    });
    mg.setWinner = vi.fn();
    winCheck = new WinCheckExecution();
    winCheck.init(mg, 0);
  });

  it("should call checkWinnerFFA in FFA mode", () => {
    const spy = vi.spyOn(winCheck as any, "checkWinnerFFA");
    winCheck.tick(10);
    expect(spy).toHaveBeenCalled();
  });

  it("should call checkWinnerTeam in non-FFA mode", () => {
    mg.config = vi.fn(() => ({
      gameConfig: vi.fn(() => ({
        maxTimerValue: 5,
        gameMode: GameMode.Team,
      })),
      percentageTilesOwnedToWin: vi.fn(() => 50),
    }));
    winCheck.init(mg, 0);
    const spy = vi.spyOn(winCheck as any, "checkWinnerTeam");
    winCheck.tick(10);
    expect(spy).toHaveBeenCalled();
  });

  it("should set winner in FFA if percentage is reached", () => {
    const player = {
      numTilesOwned: vi.fn(() => 81),
      name: vi.fn(() => "P1"),
    };
    mg.players = vi.fn(() => [player]);
    mg.numSectorTiles = vi.fn(() => 100);
    mg.numTilesWithFallout = vi.fn(() => 0);
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).toHaveBeenCalledWith(player, expect.anything());
  });

  it("should set winner in FFA if timer is 0", () => {
    const player = {
      numTilesOwned: vi.fn(() => 10),
      name: vi.fn(() => "P1"),
    };
    mg.players = vi.fn(() => [player]);
    mg.numSectorTiles = vi.fn(() => 100);
    mg.numTilesWithFallout = vi.fn(() => 0);
    mg.stats = vi.fn(() => ({ stats: () => ({ mocked: true }) }));
    // Advance ticks until timeElapsed (in seconds) >= maxTimerValue * 60
    // timeElapsed = (ticks - numSpawnPhaseTurns) / 10  =>
    // ticks >= numSpawnPhaseTurns + maxTimerValue * 600
    const threshold =
      mg.config().numSpawnPhaseTurns() +
      (mg.config().gameConfig().maxTimerValue ?? 0) * 600;
    while (mg.ticks() < threshold) {
      mg.executeNextTick();
    }
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).toHaveBeenCalledWith(player, expect.any(Object));
  });

  it("should not set winner if no players", () => {
    mg.players = vi.fn(() => []);
    winCheck.checkWinnerFFA();
    expect(mg.setWinner).not.toHaveBeenCalled();
  });

  it("should return false for activeDuringSpawnPhase", () => {
    expect(winCheck.activeDuringSpawnPhase()).toBe(false);
  });
});

describe("WinCheckExecution - Nation Winners", () => {
  test("should set Nation as winner when reaching 80% territory", async () => {
    // Setup game
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
    });

    // Create Nation player
    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_id");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Assign 81% of land to Nation
    const totalLand = game.numSectorTiles();
    const targetTiles = Math.ceil(totalLand * 0.81);
    let assigned = 0;

    game.map().forEachTile((tile) => {
      if (assigned >= targetTiles) return;
      if (!game.map().isSector(tile)) return;
      nation.conquer(tile);
      assigned++;
    });

    // Verify territory ownership
    expect(nation.numTilesOwned()).toBeGreaterThanOrEqual(targetTiles);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify Nation declared winner
    expect(setWinnerSpy).toHaveBeenCalledWith(nation, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should set Nation as winner when timer expires with most territory", async () => {
    // Setup game with timer
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
      maxTimerValue: 5,
    });

    // Create human player
    const humanInfo = new PlayerInfo(
      "HumanPlayer",
      PlayerType.Human,
      null,
      "human_id",
    );
    game.addPlayer(humanInfo);
    const human = game.player("human_id");

    // Create Nation player
    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_id");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Give Nation 60% territory (below 80% threshold)
    // Give human 30% territory
    const totalLand = game.numSectorTiles();
    const nationTiles = Math.ceil(totalLand * 0.6);
    const humanTiles = Math.ceil(totalLand * 0.3);
    let nationAssigned = 0;
    let humanAssigned = 0;

    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;

      if (nationAssigned < nationTiles) {
        nation.conquer(tile);
        nationAssigned++;
      } else if (humanAssigned < humanTiles) {
        human.conquer(tile);
        humanAssigned++;
      }
    });

    // Verify territory distribution
    expect(nation.numTilesOwned()).toBeGreaterThan(human.numTilesOwned());

    // Fast-forward game ticks past timer expiration
    const threshold =
      game.config().numSpawnPhaseTurns() +
      (game.config().gameConfig().maxTimerValue ?? 0) * 600;
    while (game.ticks() < threshold) {
      game.executeNextTick();
    }

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());
    winCheck.checkWinnerFFA();

    // Verify Nation declared winner (has most territory when timer expires)
    expect(setWinnerSpy).toHaveBeenCalledWith(nation, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should set correct Nation as winner among multiple Nations", async () => {
    // Setup game
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
    });

    // Create 3 Nation players
    const nation1Info = new PlayerInfo(
      "Nation1",
      PlayerType.Nation,
      null,
      "nation1_id",
    );
    game.addPlayer(nation1Info);
    const nation1 = game.player("nation1_id");

    const nation2Info = new PlayerInfo(
      "Nation2",
      PlayerType.Nation,
      null,
      "nation2_id",
    );
    game.addPlayer(nation2Info);
    const nation2 = game.player("nation2_id");

    const nation3Info = new PlayerInfo(
      "Nation3",
      PlayerType.Nation,
      null,
      "nation3_id",
    );
    game.addPlayer(nation3Info);
    const nation3 = game.player("nation3_id");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Assign territories: Nation1 (85%), Nation2 (10%), Nation3 (5%)
    const totalLand = game.numSectorTiles();
    const nation1Tiles = Math.ceil(totalLand * 0.85);
    const nation2Tiles = Math.ceil(totalLand * 0.1);
    let nation1Assigned = 0;
    let nation2Assigned = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let nation3Assigned = 0;

    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;

      if (nation1Assigned < nation1Tiles) {
        nation1.conquer(tile);
        nation1Assigned++;
      } else if (nation2Assigned < nation2Tiles) {
        nation2.conquer(tile);
        nation2Assigned++;
      } else {
        nation3.conquer(tile);
        nation3Assigned++;
      }
    });

    // Verify territory distribution
    expect(nation1.numTilesOwned()).toBeGreaterThan(nation2.numTilesOwned());
    expect(nation2.numTilesOwned()).toBeGreaterThan(nation3.numTilesOwned());

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify Nation1 (highest territory) declared winner
    expect(setWinnerSpy).toHaveBeenCalledWith(nation1, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should not set winner for bot team in Team mode", async () => {
    // Setup Team mode game
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.Team,
      instantBuild: true,
      playerTeams: 2,
    });

    // Create 2 bot players (auto-assigned to Bot team)
    const bot1Info = new PlayerInfo("Bot1", PlayerType.Bot, null, "bot1_id");
    game.addPlayer(bot1Info);
    const bot1 = game.player("bot1_id");

    const bot2Info = new PlayerInfo("Bot2", PlayerType.Bot, null, "bot2_id");
    game.addPlayer(bot2Info);
    const bot2 = game.player("bot2_id");

    // Verify bots are on Bot team
    expect(bot1.team()).toBe(ColoredTeams.Bot);
    expect(bot2.team()).toBe(ColoredTeams.Bot);

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Assign 96% of land to bot team (above 95% Team mode threshold)
    const totalLand = game.numSectorTiles();
    const botTeamTiles = Math.ceil(totalLand * 0.96);
    let bot1Assigned = 0;
    let bot2Assigned = 0;

    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      const totalAssigned = bot1Assigned + bot2Assigned;
      if (totalAssigned >= botTeamTiles) return;

      // Alternate between bots
      if (bot1Assigned <= bot2Assigned) {
        bot1.conquer(tile);
        bot1Assigned++;
      } else {
        bot2.conquer(tile);
        bot2Assigned++;
      }
    });

    // Verify territory ownership (bot team has > 95%)
    const botTeamTotal = bot1.numTilesOwned() + bot2.numTilesOwned();
    expect(botTeamTotal / totalLand).toBeGreaterThan(0.95);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerTeam();

    // Verify no winner declared (bot teams excluded)
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });
});

describe("WinCheckExecution - 1v1 Ranked Mode", () => {
  test("should set winner when only one human remains connected", async () => {
    // Setup game with 1v1 ranked mode and two human players
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        rankedType: RankedType.OneVOne,
      },
      [
        playerInfo("Player1", PlayerType.Human),
        playerInfo("Player2", PlayerType.Human),
      ],
    );

    const human1 = game.player("Player1");
    const human2 = game.player("Player2");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Assign some territory to both players
    let human1Count = 0;
    let human2Count = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (human1Count < 10) {
        human1.conquer(tile);
        human1Count++;
      } else if (human2Count < 10) {
        human2.conquer(tile);
        human2Count++;
      }
    });

    // Mark player 2 as disconnected
    human2.markDisconnected(true);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify the remaining connected human is declared winner
    expect(setWinnerSpy).toHaveBeenCalledWith(human1, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should not set winner when multiple humans are still connected", async () => {
    // Setup game with 1v1 ranked mode and two human players
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        rankedType: RankedType.OneVOne,
      },
      [
        playerInfo("Player1", PlayerType.Human),
        playerInfo("Player2", PlayerType.Human),
      ],
    );

    const human1 = game.player("Player1");
    const human2 = game.player("Player2");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Assign territory to both players
    let human1Count = 0;
    let human2Count = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (human1Count < 10) {
        human1.conquer(tile);
        human1Count++;
      } else if (human2Count < 10) {
        human2.conquer(tile);
        human2Count++;
      }
    });

    // Both players remain connected
    expect(human1.isDisconnected()).toBe(false);
    expect(human2.isDisconnected()).toBe(false);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify no winner declared yet (both players still connected)
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });

  test("should not set winner when no humans remain connected", async () => {
    // Setup game with 1v1 ranked mode and two human players
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        rankedType: RankedType.OneVOne,
      },
      [
        playerInfo("Player1", PlayerType.Human),
        playerInfo("Player2", PlayerType.Human),
      ],
    );

    const human1 = game.player("Player1");
    const human2 = game.player("Player2");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Both players disconnect
    human1.markDisconnected(true);
    human2.markDisconnected(true);

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify no winner declared (no connected humans)
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });

  test("should not declare a winner under domination thresholds when winCondition is elimination", async () => {
    // GDD §1 — elimination mode ignores the percentage threshold path. Even
    // a player above the legacy 80% mark should not win until everyone else
    // has been eliminated.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
      winCondition: WinCondition.Elimination,
    });

    const player1 = new PlayerInfo("P1", PlayerType.Human, null, "p1");
    game.addPlayer(player1);
    const p1 = game.player("p1");

    const player2 = new PlayerInfo("P2", PlayerType.Human, null, "p2");
    game.addPlayer(player2);
    const p2 = game.player("p2");

    while (game.inSpawnPhase()) game.executeNextTick();

    const totalLand = game.numSectorTiles();
    const p1Tiles = Math.ceil(totalLand * 0.85);
    let p1Assigned = 0;
    let p2Assigned = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (p1Assigned < p1Tiles) {
        p1.conquer(tile);
        p1Assigned++;
      } else if (p2Assigned < 5) {
        p2.conquer(tile);
        p2Assigned++;
      }
    });

    expect(p1.numTilesOwned() / totalLand).toBeGreaterThan(0.8);
    expect(p2.numTilesOwned()).toBeGreaterThan(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });

  test("should declare last-player-standing winner in elimination mode (2-player)", async () => {
    // GDD §1 — last faction standing wins. Two human players, only one
    // owns any tiles, so the survivor should immediately win.
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        winCondition: WinCondition.Elimination,
      },
      [
        playerInfo("Survivor", PlayerType.Human),
        playerInfo("Eliminated", PlayerType.Human),
      ],
    );

    const survivor = game.player("Survivor");
    // Note: "Eliminated" exists in the player set but never owns a tile,
    // simulating an elimination event before this win check fires.

    while (game.inSpawnPhase()) game.executeNextTick();

    let assigned = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (assigned < 5) {
        survivor.conquer(tile);
        assigned++;
      }
    });

    expect(survivor.numTilesOwned()).toBeGreaterThan(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    expect(setWinnerSpy).toHaveBeenCalledWith(survivor, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should not declare a winner with multiple alive factions in elimination mode", async () => {
    // GDD §1 — three players each holding tiles → no winner yet, no fall
    // through to the percentage threshold.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
      winCondition: WinCondition.Elimination,
    });

    const players = ["A", "B", "C"].map((name) => {
      const info = new PlayerInfo(name, PlayerType.Human, null, name);
      game.addPlayer(info);
      return game.player(name);
    });

    while (game.inSpawnPhase()) game.executeNextTick();

    let nextPlayer = 0;
    let assignedTotal = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (assignedTotal >= 30) return;
      players[nextPlayer % players.length].conquer(tile);
      nextPlayer++;
      assignedTotal++;
    });

    for (const p of players) expect(p.numTilesOwned()).toBeGreaterThan(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });

  test("should fall back to most-tiles winner when timer expires in elimination mode", async () => {
    // GDD §1, §12 — the 170-min/explicit timer is the safety net for
    // elimination mode. When it fires with multiple survivors, the player
    // with the most tiles wins.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
      maxTimerValue: 5,
      winCondition: WinCondition.Elimination,
    });

    const leaderInfo = new PlayerInfo("Leader", PlayerType.Human, null, "L");
    game.addPlayer(leaderInfo);
    const leader = game.player("L");
    const followerInfo = new PlayerInfo(
      "Follower",
      PlayerType.Human,
      null,
      "F",
    );
    game.addPlayer(followerInfo);
    const follower = game.player("F");

    while (game.inSpawnPhase()) game.executeNextTick();

    let leaderAssigned = 0;
    let followerAssigned = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (leaderAssigned < 50) {
        leader.conquer(tile);
        leaderAssigned++;
      } else if (followerAssigned < 5) {
        follower.conquer(tile);
        followerAssigned++;
      }
    });

    expect(leader.numTilesOwned()).toBeGreaterThan(follower.numTilesOwned());

    // Advance ticks past the per-game timer cap.
    const threshold =
      game.config().numSpawnPhaseTurns() +
      (game.config().gameConfig().maxTimerValue ?? 0) * 600;
    while (game.ticks() < threshold) game.executeNextTick();

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());
    winCheck.checkWinnerFFA();

    expect(setWinnerSpy).toHaveBeenCalledWith(leader, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should declare team winner via elimination when only one non-bot team holds tiles", async () => {
    // GDD §1 — team elimination: a team wins as soon as all other non-bot
    // teams have zero tiles. Bots are excluded from the candidate set.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.Team,
      instantBuild: true,
      playerTeams: 2,
      winCondition: WinCondition.Elimination,
    });

    // Auto-team assignment alternates colors; for the test we just give all
    // tiles to one of them via the player API.
    const player1 = new PlayerInfo(
      "TeamerA",
      PlayerType.Human,
      null,
      "teamerA",
    );
    game.addPlayer(player1);
    const player2 = new PlayerInfo(
      "TeamerB",
      PlayerType.Human,
      null,
      "teamerB",
    );
    game.addPlayer(player2);

    const a = game.player("teamerA");
    const b = game.player("teamerB");

    // Skip the spawn phase BEFORE assigning territory so PlayerExecution
    // doesn't reap the unowned player on the same tick.
    while (game.inSpawnPhase()) game.executeNextTick();

    let assigned = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (assigned < 10) {
        a.conquer(tile);
        assigned++;
      }
    });

    // Sanity: A holds tiles, B does not, and they are on different teams.
    expect(a.numTilesOwned()).toBeGreaterThan(0);
    expect(b.numTilesOwned()).toBe(0);
    expect(a.team()).not.toBe(b.team());

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerTeam();

    expect(setWinnerSpy).toHaveBeenCalledWith(a.team(), expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should ignore bots and nations in 1v1 ranked mode", async () => {
    // Setup game with 1v1 ranked mode, one human, one bot, and one nation
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        rankedType: RankedType.OneVOne,
      },
      [
        playerInfo("HumanPlayer", PlayerType.Human),
        playerInfo("BotPlayer", PlayerType.Bot),
        playerInfo("NationPlayer", PlayerType.Nation),
      ],
    );

    const human = game.player("HumanPlayer");
    const bot = game.player("BotPlayer");
    const nation = game.player("NationPlayer");

    // Skip spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Assign territory to all players
    let humanCount = 0;
    let botCount = 0;
    let nationCount = 0;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (humanCount < 10) {
        human.conquer(tile);
        humanCount++;
      } else if (botCount < 10) {
        bot.conquer(tile);
        botCount++;
      } else if (nationCount < 10) {
        nation.conquer(tile);
        nationCount++;
      }
    });

    // Mock setWinner to capture calls
    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;

    // Initialize and run win check
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    // Verify human is declared winner (only one human player)
    expect(setWinnerSpy).toHaveBeenCalledWith(human, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });
});
