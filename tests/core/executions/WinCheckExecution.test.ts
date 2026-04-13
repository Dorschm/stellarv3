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

  test("should eliminate a player with tiles but zero population after the grace period (elimination mode)", async () => {
    // GDD §12 — a player who owns tiles but has 0 population is functionally
    // dead. They should be eliminated once the grace window has passed.
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
        playerInfo("ZeroPop", PlayerType.Human),
      ],
    );

    const survivor = game.player("Survivor");
    const zeroPop = game.player("ZeroPop");

    while (game.inSpawnPhase()) game.executeNextTick();

    let sAssigned = 0;
    let zAssigned = 0;
    let survivorSpawn: number | undefined;
    let zeroPopSpawn: number | undefined;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (sAssigned < 10) {
        survivor.conquer(tile);
        survivorSpawn ??= tile;
        sAssigned++;
      } else if (zAssigned < 10) {
        zeroPop.conquer(tile);
        zeroPopSpawn ??= tile;
        zAssigned++;
      }
    });
    // Set spawn tiles so the elimination path's `hasSpawned()` guard passes
    // — `conquer` alone does not mark a player as spawned.
    if (survivorSpawn !== undefined) survivor.setSpawnTile(survivorSpawn);
    if (zeroPopSpawn !== undefined) zeroPop.setSpawnTile(zeroPopSpawn);

    // Give the survivor real population so they aren't tripped by the same
    // zero-pop grace window; keep zeroPop explicitly at zero.
    survivor.setPopulation(1000);
    zeroPop.setPopulation(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());

    // First tick: grace window opens, no winner yet.
    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);

    // Advance past the 50-tick grace window.
    for (let i = 0; i < 60; i++) game.executeNextTick();
    // Ensure population is still zero after simulation ticks.
    zeroPop.setPopulation(0);

    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).toHaveBeenCalledWith(survivor, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should NOT eliminate a player whose population recovers within the grace window", async () => {
    // GDD §12 — shuttle launches and trade payloads can momentarily drain a
    // player's population to 0. Those transients must not end the run.
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        winCondition: WinCondition.Elimination,
      },
      [playerInfo("A", PlayerType.Human), playerInfo("B", PlayerType.Human)],
    );

    const a = game.player("A");
    const b = game.player("B");

    while (game.inSpawnPhase()) game.executeNextTick();

    let aAssigned = 0;
    let bAssigned = 0;
    let aSpawn: number | undefined;
    let bSpawn: number | undefined;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (aAssigned < 10) {
        a.conquer(tile);
        aSpawn ??= tile;
        aAssigned++;
      } else if (bAssigned < 10) {
        b.conquer(tile);
        bSpawn ??= tile;
        bAssigned++;
      }
    });
    if (aSpawn !== undefined) a.setSpawnTile(aSpawn);
    if (bSpawn !== undefined) b.setSpawnTile(bSpawn);

    a.setPopulation(1000);
    b.setPopulation(0); // Transient 0-pop

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());

    // Open the grace window.
    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).not.toHaveBeenCalled();

    // Population recovers before grace expires.
    b.setPopulation(500);

    // Advance well past the grace window; B should no longer be flagged.
    for (let i = 0; i < 100; i++) game.executeNextTick();

    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);
  });

  test("should ignore population in domination mode", async () => {
    // Domination mode is unaffected by the zero-pop rule — legacy lobbies
    // continue to use the percentage-of-tiles threshold exclusively.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.FFA,
      instantBuild: true,
      // No winCondition override — falls back to default (Domination).
    });

    const info = new PlayerInfo("Dom", PlayerType.Human, null, "dom");
    game.addPlayer(info);
    const dom = game.player("dom");

    while (game.inSpawnPhase()) game.executeNextTick();

    const totalLand = game.numSectorTiles();
    const target = Math.ceil(totalLand * 0.81);
    let assigned = 0;
    game.map().forEachTile((tile) => {
      if (assigned >= target) return;
      if (!game.map().isSector(tile)) return;
      dom.conquer(tile);
      assigned++;
    });
    dom.setPopulation(0); // Zero pop must NOT block a domination win.

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, 0);
    winCheck.checkWinnerFFA();

    expect(setWinnerSpy).toHaveBeenCalledWith(dom, expect.anything());
  });

  test("should eliminate a team whose combined population is zero past the grace window", async () => {
    // GDD §12 team counterpart — a team with tiles but zero combined pop
    // for longer than the grace window is removed from the candidate set.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.Team,
      instantBuild: true,
      playerTeams: 2,
      winCondition: WinCondition.Elimination,
    });

    const aInfo = new PlayerInfo("TA", PlayerType.Human, null, "ta");
    game.addPlayer(aInfo);
    const bInfo = new PlayerInfo("TB", PlayerType.Human, null, "tb");
    game.addPlayer(bInfo);
    const a = game.player("ta");
    const b = game.player("tb");

    while (game.inSpawnPhase()) game.executeNextTick();

    let aAssigned = 0;
    let bAssigned = 0;
    let aSpawn: number | undefined;
    let bSpawn: number | undefined;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (aAssigned < 10) {
        a.conquer(tile);
        aSpawn ??= tile;
        aAssigned++;
      } else if (bAssigned < 10) {
        b.conquer(tile);
        bSpawn ??= tile;
        bAssigned++;
      }
    });
    if (aSpawn !== undefined) a.setSpawnTile(aSpawn);
    if (bSpawn !== undefined) b.setSpawnTile(bSpawn);

    expect(a.team()).not.toBe(b.team());

    a.setPopulation(1000);
    b.setPopulation(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());

    // Open grace window.
    winCheck.checkWinnerTeam();
    expect(setWinnerSpy).not.toHaveBeenCalled();

    for (let i = 0; i < 60; i++) game.executeNextTick();
    b.setPopulation(0);

    winCheck.checkWinnerTeam();
    expect(setWinnerSpy).toHaveBeenCalledWith(a.team(), expect.anything());
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

  test("should immediately resolve FFA elimination when all survivors hit zero population on the same tick", async () => {
    // GDD §12 — if every remaining player's population drops to zero within
    // the same grace window, the alive set is empty and waiting on the
    // timer would soft-deadlock the run. Resolve immediately via the
    // most-tiles tie-break.
    const game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        gameMode: GameMode.FFA,
        instantBuild: true,
        maxTimerValue: 5,
        winCondition: WinCondition.Elimination,
      },
      [
        playerInfo("Leader", PlayerType.Human),
        playerInfo("Follower", PlayerType.Human),
      ],
    );

    const leader = game.player("Leader");
    const follower = game.player("Follower");

    while (game.inSpawnPhase()) game.executeNextTick();

    let leaderAssigned = 0;
    let followerAssigned = 0;
    let leaderSpawn: number | undefined;
    let followerSpawn: number | undefined;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (leaderAssigned < 20) {
        leader.conquer(tile);
        leaderSpawn ??= tile;
        leaderAssigned++;
      } else if (followerAssigned < 5) {
        follower.conquer(tile);
        followerSpawn ??= tile;
        followerAssigned++;
      }
    });
    if (leaderSpawn !== undefined) leader.setSpawnTile(leaderSpawn);
    if (followerSpawn !== undefined) follower.setSpawnTile(followerSpawn);

    expect(leader.numTilesOwned()).toBeGreaterThan(follower.numTilesOwned());

    // Both players at zero population simultaneously.
    leader.setPopulation(0);
    follower.setPopulation(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());

    // Open grace window — neither is declared yet.
    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);

    // Advance past grace window; populations are still zero for both.
    for (let i = 0; i < 60; i++) game.executeNextTick();
    leader.setPopulation(0);
    follower.setPopulation(0);

    // Timer has NOT expired yet — the fix must resolve immediately anyway.
    const elapsedSeconds =
      (game.ticks() - game.config().numSpawnPhaseTurns()) / 10;
    expect(elapsedSeconds).toBeLessThan(
      (game.config().gameConfig().maxTimerValue ?? 0) * 60,
    );

    winCheck.checkWinnerFFA();
    expect(setWinnerSpy).toHaveBeenCalledWith(leader, expect.anything());
    expect(winCheck.isActive()).toBe(false);
  });

  test("should immediately resolve Team elimination when all non-bot teams hit zero population on the same tick", async () => {
    // GDD §12 team counterpart — simultaneous zero-pop outcomes across all
    // non-bot teams must not stall the run until the timer fires.
    const game = await setup("big_plains", {
      infiniteCredits: true,
      gameMode: GameMode.Team,
      instantBuild: true,
      playerTeams: 2,
      maxTimerValue: 5,
      winCondition: WinCondition.Elimination,
    });

    const aInfo = new PlayerInfo("TA", PlayerType.Human, null, "ta");
    game.addPlayer(aInfo);
    const bInfo = new PlayerInfo("TB", PlayerType.Human, null, "tb");
    game.addPlayer(bInfo);
    const a = game.player("ta");
    const b = game.player("tb");

    while (game.inSpawnPhase()) game.executeNextTick();

    let aAssigned = 0;
    let bAssigned = 0;
    let aSpawn: number | undefined;
    let bSpawn: number | undefined;
    game.map().forEachTile((tile) => {
      if (!game.map().isSector(tile)) return;
      if (aAssigned < 20) {
        a.conquer(tile);
        aSpawn ??= tile;
        aAssigned++;
      } else if (bAssigned < 5) {
        b.conquer(tile);
        bSpawn ??= tile;
        bAssigned++;
      }
    });
    if (aSpawn !== undefined) a.setSpawnTile(aSpawn);
    if (bSpawn !== undefined) b.setSpawnTile(bSpawn);

    expect(a.team()).not.toBe(b.team());
    expect(a.numTilesOwned()).toBeGreaterThan(b.numTilesOwned());

    // Both teams' combined populations at zero simultaneously.
    a.setPopulation(0);
    b.setPopulation(0);

    const setWinnerSpy = vi.fn();
    game.setWinner = setWinnerSpy;
    const winCheck = new WinCheckExecution();
    winCheck.init(game, game.ticks());

    // Open the grace window.
    winCheck.checkWinnerTeam();
    expect(setWinnerSpy).not.toHaveBeenCalled();
    expect(winCheck.isActive()).toBe(true);

    // Advance past the grace window while keeping populations at zero.
    for (let i = 0; i < 60; i++) game.executeNextTick();
    a.setPopulation(0);
    b.setPopulation(0);

    // Timer has NOT expired — the fix must resolve immediately anyway.
    const elapsedSeconds =
      (game.ticks() - game.config().numSpawnPhaseTurns()) / 10;
    expect(elapsedSeconds).toBeLessThan(
      (game.config().gameConfig().maxTimerValue ?? 0) * 60,
    );

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
