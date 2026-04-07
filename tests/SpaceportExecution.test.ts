import { SpaceportExecution } from "../src/core/execution/SpaceportExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let other: Player;

describe("SpaceportExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, null, "player_id"),
        new PlayerInfo("other", PlayerType.Human, null, "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    player.addCredits(BigInt(1000000));
    other = game.player("other_id");

    game.config().structureMinDist = () => 10;
  });

  test("Destination ports chances scale with level", () => {
    game.config().proximityBonusSpaceportsNb = () => 0;
    game.config().tradeFreighterShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Spaceport, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Spaceport, spawn, {});
    const execution = new SpaceportExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    const otherPort = other.buildUnit(UnitType.Spaceport, game.ref(0, 0), {});
    otherPort.increaseLevel();
    otherPort.increaseLevel();

    const ports = execution.tradingPorts();

    expect(ports.length).toBe(3);
  });

  test("Trade ship proximity bonus", () => {
    game.config().proximityBonusSpaceportsNb = () => 10;
    game.config().tradeFreighterShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Spaceport, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Spaceport, spawn, {});
    const execution = new SpaceportExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    other.buildUnit(UnitType.Spaceport, game.ref(0, 0), {});

    const ports = execution.tradingPorts();

    expect(ports.length).toBe(2);
  });

  test("Trade ship short range debuff", () => {
    game.config().proximityBonusSpaceportsNb = () => 10;
    // Short range debuff cancels out the proximity bonus.
    game.config().tradeFreighterShortRangeDebuff = () => 100;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Spaceport, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Spaceport, spawn, {});
    const execution = new SpaceportExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    other.buildUnit(UnitType.Spaceport, game.ref(0, 0), {});

    const ports = execution.tradingPorts();

    expect(ports.length).toBe(1);
  });
});
