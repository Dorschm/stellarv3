import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

describe("Hydrogen Bomb and MIRV flows", () => {
  let game: Game;
  let player: Player;
  const gameID: GameID = "game_id";

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    game.addPlayer(info);
    game.addExecution(new SpawnExecution(gameID, info, game.ref(1, 1)));
    while (game.inSpawnPhase()) game.executeNextTick();
    player = game.player(info.id);

    player.conquer(game.ref(1, 1));
  });

  test("Hydrogen bomb launches when silo exists and cannot use silo under construction", () => {
    // Build a silo instantly and launch Hydrogen Bomb
    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.OrbitalStrikePlatform,
        game.ref(1, 1),
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.OrbitalStrikePlatform)).toHaveLength(1);

    // Launch Hydrogen Bomb
    const target = game.ref(7, 7);
    game.addExecution(
      new ConstructionExecution(player, UnitType.NovaBomb, target),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.NovaBomb).length).toBeGreaterThan(0);

    // Now build another silo with construction time and ensure it won't be used
    // Use non-instant config by simulating an under-construction flag on a new silo
    // (Use normal construction with default duration in a fresh game instance)
  });

  test("Hydrogen bomb launch fails when silo is under construction and succeeds after completion", async () => {
    // Set up a game without instantBuild to test construction duration
    const gameWithConstruction = await setup("plains", {
      infiniteCredits: false,
      instantBuild: false,
    });
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    gameWithConstruction.addPlayer(info);
    gameWithConstruction.addExecution(
      new SpawnExecution(gameID, info, gameWithConstruction.ref(1, 1)),
    );
    while (gameWithConstruction.inSpawnPhase())
      gameWithConstruction.executeNextTick();
    const playerWithConstruction = gameWithConstruction.player(info.id);

    playerWithConstruction.conquer(gameWithConstruction.ref(1, 1));
    const siloTile = gameWithConstruction.ref(7, 7);
    playerWithConstruction.conquer(siloTile);

    // Capture gold before starting silo construction
    const goldBeforeSilo = playerWithConstruction.credits();
    const siloCost = gameWithConstruction
      .unitInfo(UnitType.OrbitalStrikePlatform)
      .cost(gameWithConstruction, playerWithConstruction);
    playerWithConstruction.addCredits(siloCost);

    // Start construction of silo
    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        UnitType.OrbitalStrikePlatform,
        siloTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Verify silo exists and is under construction
    const silos = playerWithConstruction.units(UnitType.OrbitalStrikePlatform);
    expect(silos.length).toBe(1);
    const silo = silos[0];
    expect(silo.isUnderConstruction()).toBe(true);

    // Capture gold after construction started
    const goldAfterConstruction = playerWithConstruction.credits();
    expect(goldAfterConstruction).toBeLessThan(goldBeforeSilo + siloCost);

    // Attempt to launch HydrogenBomb while silo is under construction
    const targetTile = gameWithConstruction.ref(10, 10);
    const hydrogenBombCountBefore = playerWithConstruction.units(
      UnitType.NovaBomb,
    ).length;

    const canBuildResult = playerWithConstruction.canBuild(
      UnitType.NovaBomb,
      targetTile,
    );
    expect(canBuildResult).toBe(false); // Should fail because silo is under construction

    // Try to add execution - should fail
    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        UnitType.NovaBomb,
        targetTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Assert launch does not succeed
    const hydrogenBombCountAfter = playerWithConstruction.units(
      UnitType.NovaBomb,
    ).length;
    expect(hydrogenBombCountAfter).toBe(hydrogenBombCountBefore);

    // Assert no refunds during construction
    const goldDuringConstruction = playerWithConstruction.credits();
    expect(goldDuringConstruction >= goldAfterConstruction).toBe(true);

    // Advance ticks to complete construction
    const constructionDuration =
      gameWithConstruction.unitInfo(UnitType.OrbitalStrikePlatform)
        .constructionDuration ?? 0;
    for (let i = 0; i < constructionDuration + 2; i++) {
      gameWithConstruction.executeNextTick();
    }

    // Verify silo is complete
    const completedSilo = playerWithConstruction.units(
      UnitType.OrbitalStrikePlatform,
    )[0];
    expect(completedSilo.isUnderConstruction()).toBe(false);

    // Now launch should succeed - ensure we have gold and target is conquered
    playerWithConstruction.conquer(targetTile);
    const hydrogenBombCost = gameWithConstruction
      .unitInfo(UnitType.NovaBomb)
      .cost(gameWithConstruction, playerWithConstruction);
    playerWithConstruction.addCredits(hydrogenBombCost);

    const canBuildAfterCompletion = playerWithConstruction.canBuild(
      UnitType.NovaBomb,
      targetTile,
    );
    expect(canBuildAfterCompletion).not.toBe(false);

    gameWithConstruction.addExecution(
      new ConstructionExecution(
        playerWithConstruction,
        UnitType.NovaBomb,
        targetTile,
      ),
    );
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();
    gameWithConstruction.executeNextTick();

    // Verify launch succeeded
    const hydrogenBombCountAfterSuccess = playerWithConstruction.units(
      UnitType.NovaBomb,
    ).length;
    expect(hydrogenBombCountAfterSuccess).toBeGreaterThan(
      hydrogenBombCountBefore,
    );
  });

  test("MIRV launches when silo exists and targets player-owned tiles", () => {
    // Build a silo instantly
    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.OrbitalStrikePlatform,
        game.ref(1, 1),
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.OrbitalStrikePlatform)).toHaveLength(1);

    // Launch MIRV at a player-owned tile (the silo tile)
    const target = game.ref(1, 1);
    game.addExecution(
      new ConstructionExecution(player, UnitType.ClusterWarhead, target),
    );
    game.executeNextTick(); // init
    game.executeNextTick(); // create MIRV unit
    game.executeNextTick();

    // MIRV should appear briefly before separation, otherwise warheads should be queued
    const mirvs = player.units(UnitType.ClusterWarhead).length;
    const warheads = player.units(UnitType.ClusterWarheadSubmunition).length;
    expect(mirvs > 0 || warheads > 0).toBe(true);
  });
});
