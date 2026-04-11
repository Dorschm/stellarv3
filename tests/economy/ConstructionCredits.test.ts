import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../src/core/execution/NukeExecution";
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

describe("Construction economy", () => {
  let game: Game;
  const gameID: GameID = "game_id";
  let player: Player;
  let other: Player;
  const builderInfo = new PlayerInfo(
    "builder",
    PlayerType.Human,
    null,
    "builder_id",
  );
  const otherInfo = new PlayerInfo("other", PlayerType.Human, null, "other_id");

  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteCredits: false,
        instantBuild: false,
        infinitePopulation: true,
      },
      [builderInfo, otherInfo],
    );
    const spawn = game.ref(0, 10);
    game.addExecution(new SpawnExecution(gameID, builderInfo, spawn));
    game.addExecution(new SpawnExecution(gameID, otherInfo, spawn));
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    player = game.player(builderInfo.id);
    other = game.player(otherInfo.id);
  });

  test("City charges gold once and no refund thereafter (allow passive income)", () => {
    const target = game.ref(0, 10);
    const cost = game.unitInfo(UnitType.Colony).cost(game, player);
    player.addCredits(cost);
    expect(player.credits()).toBe(cost);

    const startTick = game.ticks();
    game.addExecution(
      new ConstructionExecution(player, UnitType.Colony, target),
    );

    // First tick usually initializes the execution, second tick performs build and deduction
    game.executeNextTick();
    game.executeNextTick();
    const afterBuild = player.credits();
    const ticksAfterBuild = BigInt(game.ticks() - startTick);
    const passivePerTick = 100n; // DefaultConfig goldAdditionRate for humans
    expect(afterBuild < cost).toBe(true); // cost was deducted
    expect(afterBuild <= ticksAfterBuild * passivePerTick).toBe(true); // only passive income allowed

    // Advance through construction duration
    const duration = game.unitInfo(UnitType.Colony).constructionDuration ?? 0;
    for (let i = 0; i <= duration + 2; i++) game.executeNextTick();

    const finalGold = player.credits();
    const ticksElapsed = BigInt(game.ticks() - startTick);
    // Ensure no refund equal to cost snuck back in; only passive income accumulated
    expect(finalGold < cost).toBe(true);
    expect(finalGold <= ticksElapsed * passivePerTick).toBe(true);

    // Structure exists and is active
    expect(player.units(UnitType.Colony)).toHaveLength(1);
    expect(
      (player.units(UnitType.Colony)[0] as any).isUnderConstruction?.() ??
        false,
    ).toBe(false);
  });

  test("DefenseStation uses exponential cost scaling with 800k cap", () => {
    // GDD §5 — all structures stack; exponential scaling.
    // Expected curve: 50k → 100k → 200k → 400k → 800k (cap) → 800k …
    const cost = () =>
      game.config().unitInfo(UnitType.DefenseStation).cost(game, player);

    // Each "owned" unit bumps the next cost one rung up the curve.
    // We mint ownership by directly conquering a tile and calling
    // buildUnit — the costWrapper reads unitsOwned/unitsConstructed.
    const tiles = [
      game.ref(2, 2),
      game.ref(2, 3),
      game.ref(2, 4),
      game.ref(2, 5),
      game.ref(2, 6),
      game.ref(2, 7),
    ];
    for (const t of tiles) player.conquer(t);

    // Unit 0 — baseline.
    expect(cost()).toBe(50_000n);
    player.buildUnit(UnitType.DefenseStation, tiles[0], {});

    // Unit 1 — matches old linear curve (100k).
    expect(cost()).toBe(100_000n);
    player.buildUnit(UnitType.DefenseStation, tiles[1], {});

    // Unit 2 — first divergence from the old linear formula (150k → 200k).
    expect(cost()).toBe(200_000n);
    player.buildUnit(UnitType.DefenseStation, tiles[2], {});

    // Unit 3 — 400k (old formula would be 200k, capped).
    expect(cost()).toBe(400_000n);
    player.buildUnit(UnitType.DefenseStation, tiles[3], {});

    // Unit 4 — hits the new 800k cap.
    expect(cost()).toBe(800_000n);
    player.buildUnit(UnitType.DefenseStation, tiles[4], {});

    // Unit 5 — cap engaged, stays at 800k.
    expect(cost()).toBe(800_000n);
  });

  test("PointDefenseArray uses exponential cost scaling with 6M cap", () => {
    // GDD §5 — exponential scaling. 1.5M → 3M → 6M (cap) → 6M …
    const cost = () =>
      game.config().unitInfo(UnitType.PointDefenseArray).cost(game, player);

    const tiles = [
      game.ref(3, 2),
      game.ref(3, 3),
      game.ref(3, 4),
      game.ref(3, 5),
    ];
    for (const t of tiles) player.conquer(t);

    // Unit 0 — baseline, matches old formula.
    expect(cost()).toBe(1_500_000n);
    player.buildUnit(UnitType.PointDefenseArray, tiles[0], {});

    // Unit 1 — matches old linear curve (3M).
    expect(cost()).toBe(3_000_000n);
    player.buildUnit(UnitType.PointDefenseArray, tiles[1], {});

    // Unit 2 — first divergence: old formula would have capped at 3M,
    // new exponential formula doubles to 6M (the new cap).
    expect(cost()).toBe(6_000_000n);
    player.buildUnit(UnitType.PointDefenseArray, tiles[2], {});

    // Unit 3 — cap engaged, stays at 6M.
    expect(cost()).toBe(6_000_000n);
  });

  test("infiniteCredits bypasses DefenseStation and PDA cost scaling", async () => {
    // Spin up a separate game with infiniteCredits so we don't disturb
    // the shared beforeEach state.
    const cheatGame = await setup(
      "plains",
      {
        infiniteCredits: true,
        instantBuild: false,
        infinitePopulation: true,
      },
      [builderInfo],
    );
    const spawn = cheatGame.ref(0, 10);
    cheatGame.addExecution(new SpawnExecution(gameID, builderInfo, spawn));
    while (cheatGame.inSpawnPhase()) {
      cheatGame.executeNextTick();
    }
    const cheatPlayer = cheatGame.player(builderInfo.id);

    expect(
      cheatGame
        .config()
        .unitInfo(UnitType.DefenseStation)
        .cost(cheatGame, cheatPlayer),
    ).toBe(0n);
    expect(
      cheatGame
        .config()
        .unitInfo(UnitType.PointDefenseArray)
        .cost(cheatGame, cheatPlayer),
    ).toBe(0n);
  });

  test("MIRV gets more expensive with each launch", () => {
    expect(
      game.config().unitInfo(UnitType.ClusterWarhead).cost(game, other),
    ).toBe(25_000_000n);

    player.addCredits(100_000_000n);

    player.conquer(game.ref(1, 1));
    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(1, 1), {});

    other.conquer(game.ref(10, 10));
    game.addExecution(
      new NukeExecution(UnitType.ClusterWarhead, player, game.ref(10, 10)),
    );
    game.executeNextTick(); // init
    game.executeNextTick(); // create MIRV unit
    game.executeNextTick();

    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);

    // Price of the MIRV increases for everyone with each launch.
    expect(
      game.config().unitInfo(UnitType.ClusterWarhead).cost(game, other),
    ).toBe(40_000_000n);
  });
});
