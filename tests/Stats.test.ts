import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { Stats } from "../src/core/game/Stats";
import { StatsImpl } from "../src/core/game/StatsImpl";
import { replacer } from "../src/core/Util";
import { setup } from "./util/Setup";

let stats: Stats;
let game: Game;
let player1: Player;
let player2: Player;

describe("Stats", () => {
  beforeEach(async () => {
    stats = new StatsImpl();
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("boat dude", PlayerType.Human, "client1", "player_1_id"),
      new PlayerInfo("boat dude", PlayerType.Human, "client2", "player_2_id"),
    ]);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("attack", () => {
    stats.attack(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        attacks: [1n],
      },
      client2: {
        attacks: [0n, 1n],
      },
    });
  });

  test("attackCancel", () => {
    stats.attackCancel(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        attacks: [-1n, 0n, 1n],
      },
      client2: {
        attacks: [0n, -1n],
      },
    });
  });

  test("betray", () => {
    stats.betray(player1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        betrayals: 1n,
      },
    });
  });

  test("freighterSendTrade", () => {
    stats.freighterSendTrade(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: {
          trade: [1n],
        },
      },
    });
  });

  test("freighterArriveTrade", () => {
    stats.freighterArriveTrade(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 1n] },
        gold: [0n, 0n, 1n],
      },
      client2: {
        gold: [0n, 0n, 1n],
      },
    });
  });

  test("freighterCapturedTrade", () => {
    stats.freighterCapturedTrade(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 0n, 1n] },
        gold: [0n, 0n, 0n, 1n],
      },
    });
  });

  test("freighterDestroyTrade", () => {
    stats.freighterDestroyTrade(player1, player2);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trade: [0n, 0n, 0n, 1n] },
      },
    });
  });

  test("shuttleSendTroops", () => {
    stats.shuttleSendTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: {
          trans: [1n],
        },
      },
    });
  });

  test("shuttleArriveTroops", () => {
    stats.shuttleArriveTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trans: [0n, 1n] },
      },
    });
  });

  test("shuttleDestroyTroops", () => {
    stats.shuttleDestroyTroops(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        boats: { trans: [0n, 0n, 0n, 1n] },
      },
    });
  });

  test("bombLaunch", () => {
    stats.bombLaunch(player1, player2, UnitType.AntimatterTorpedo);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { abomb: [1n] } },
    });
  });

  test("bombLand", () => {
    stats.bombLand(player1, player2, UnitType.NovaBomb);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { hbomb: [0n, 1n] } },
    });
  });

  test("bombIntercept", () => {
    stats.bombIntercept(player1, UnitType.ClusterWarheadSubmunition, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { bombs: { mirvw: [0n, 0n, 1n] } },
    });
  });

  test("creditsWar", () => {
    stats.creditsWar(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        gold: [0n, 1n],
        conquests: [1n],
      },
    });
    stats.creditsWar(player1, player2, 1);
    expect(stats.stats()).toStrictEqual({
      client1: {
        gold: [0n, 2n],
        conquests: [2n],
      },
    });
  });

  test("creditsWork", () => {
    stats.creditsWork(player1, 1);
    expect(stats.stats()).toStrictEqual({
      client1: { gold: [1n] },
    });
  });

  test("unitBuild", () => {
    stats.unitBuild(player1, UnitType.Colony);
    expect(stats.stats()).toStrictEqual({
      client1: { units: { city: [1n] } },
    });
  });

  test("unitCapture", () => {
    stats.unitCapture(player1, UnitType.DefenseStation);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          defp: [0n, 0n, 1n],
        },
      },
    });
  });

  test("unitDestroy", () => {
    stats.unitDestroy(player1, UnitType.OrbitalStrikePlatform);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          silo: [0n, 1n],
        },
      },
    });
  });

  test("unitLose", () => {
    stats.unitLose(player1, UnitType.Spaceport);
    expect(stats.stats()).toStrictEqual({
      client1: {
        units: {
          port: [0n, 0n, 0n, 1n],
        },
      },
    });
  });

  test("playerKilled", () => {
    stats.playerKilled(player1, 10);
    stats.playerKilled(player2, 40);
    expect(stats.stats()).toStrictEqual({
      client1: {
        killedAt: 10n,
      },
      client2: {
        killedAt: 40n,
      },
    });
  });

  test("stringify", () => {
    stats.unitLose(player1, UnitType.Spaceport);
    expect(JSON.stringify(stats.stats(), replacer)).toBe(
      '{"client1":{"units":{"port":["0","0","0","1"]}}}',
    );
  });
});
