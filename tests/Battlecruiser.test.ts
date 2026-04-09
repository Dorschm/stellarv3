import { BattlecruiserExecution } from "../src/core/execution/BattlecruiserExecution";
import { MoveBattlecruiserExecution } from "../src/core/execution/MoveBattlecruiserExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Battlecruiser", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteCredits: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("pilot alpha", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("pilot alpha", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Battlecruiser heals only if player has spaceport", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Battlecruiser).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    const port = player1.buildUnit(
      UnitType.Spaceport,
      game.ref(coastX, 10),
      {},
    );
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    game.executeNextTick();

    expect(battlecruiser.health()).toBe(maxHealth);
    battlecruiser.modifyHealth(-10);
    expect(battlecruiser.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(battlecruiser.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(battlecruiser.health()).toBe(maxHealth - 9);
  });

  test("Battlecruiser captures trade if player has spaceport", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Spaceport, portTile, {});
    game.addExecution(
      new BattlecruiserExecution(
        player1.buildUnit(UnitType.Battlecruiser, portTile, {
          patrolTile: portTile,
        }),
      ),
    );

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 7),
      {
        targetUnit: player2.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 10),
          {},
        ),
      },
    );

    expect(tradeFreighter.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeFreighter.owner()).toBe(player1);
  });

  test("Battlecruiser do not capture trade if player has no spaceport", async () => {
    game.addExecution(
      new BattlecruiserExecution(
        player1.buildUnit(UnitType.Battlecruiser, game.ref(coastX + 1, 11), {
          patrolTile: game.ref(coastX + 1, 11),
        }),
      ),
    );

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 11),
      {
        targetUnit: player1.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 11),
          {},
        ),
      },
    );

    expect(tradeFreighter.owner().id()).toBe(player2.id());
    // Let plenty of time for battlecruiser to potentially capture trade freighter
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(tradeFreighter.owner().id()).toBe(player2.id());
  });

  test("Battlecruiser does not target trade freighters that are safe from pirates", async () => {
    // build port so battlecruiser can target trade freighters
    player1.buildUnit(UnitType.Spaceport, game.ref(coastX, 10), {});

    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 10),
      {
        targetUnit: player2.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 10),
          {},
        ),
      },
    );

    tradeFreighter.setSafeFromRaiders();

    executeTicks(game, 10);

    expect(tradeFreighter.owner().id()).toBe(player2.id());
  });

  test("Battlecruiser moves to new patrol tile", async () => {
    game.config().battlecruiserTargettingRange = () => 1;

    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new BattlecruiserExecution(battlecruiser));

    game.addExecution(
      new MoveBattlecruiserExecution(
        player1,
        battlecruiser.id(),
        game.ref(coastX + 5, 15),
      ),
    );

    executeTicks(game, 10);

    expect(battlecruiser.patrolTile()).toBe(game.ref(coastX + 5, 15));
  });

  test("Battlecruiser does not not target trade freighters outside of patrol range", async () => {
    game.config().battlecruiserTargettingRange = () => 3;

    // build port so battlecruiser can target trade freighters
    player1.buildUnit(UnitType.Spaceport, game.ref(coastX, 10), {});

    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 15),
      {
        targetUnit: player2.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 10),
          {},
        ),
      },
    );

    executeTicks(game, 10);

    // Trade ship should not be captured
    expect(tradeFreighter.owner().id()).toBe(player2.id());
  });

  test("MoveBattlecruiserExecution fails if player is not the owner", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    new MoveBattlecruiserExecution(
      player2,
      battlecruiser.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(battlecruiser.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveBattlecruiserExecution fails if battlecruiser is not active", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    battlecruiser.delete();
    new MoveBattlecruiserExecution(
      player1,
      battlecruiser.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(battlecruiser.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveBattlecruiserExecution fails gracefully if battlecruiser not found", async () => {
    const exec = new MoveBattlecruiserExecution(
      player1,
      123,
      game.ref(coastX + 5, 15),
    );

    // Verify that no error is thrown.
    exec.init(game, 0);

    expect(exec.isActive()).toBe(false);
  });
});
