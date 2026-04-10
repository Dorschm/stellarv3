// @vitest-environment node
import { ScoutSwarmExecution } from "../../../src/core/execution/ScoutSwarmExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

/**
 * Unit tests for ScoutSwarmExecution (GDD §4/§6, Ticket 6).
 *
 * Scout Swarms are temporary units that cost 10% of the launcher's current
 * credits, travel in deep space toward a target tile, and dissolve on
 * arrival. Once {@link Config.scoutSwarmTerraformAccumulation} arrivals
 * have landed on a tile, its terrain steps one band toward habitability
 * (AsteroidField → Nebula → OpenSpace).
 *
 * All tests run on `big_plains` which has enough sector tiles for the
 * launcher to own territory at varying distances from the target.
 */

const gameID: GameID = "scout_swarm_game";

let game: Game;
let launcher: Player;

async function buildGame() {
  game = await setup("big_plains", {
    infiniteCredits: false,
    instantBuild: true,
  });
  game.addPlayer(
    new PlayerInfo("scout_launcher", PlayerType.Human, null, "scout_launcher"),
  );

  game.addExecution(
    new SpawnExecution(
      gameID,
      game.player("scout_launcher").info(),
      game.ref(5, 5),
    ),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  launcher = game.player("scout_launcher");
}

describe("ScoutSwarmExecution — launch cost", () => {
  beforeEach(async () => {
    await buildGame();
  });

  test("deducts exactly 10% of the launcher's current credits", () => {
    const INITIAL = 1000n;
    // Reset credits to a known value so the deduction math is easy.
    launcher.removeCredits(launcher.credits());
    launcher.addCredits(INITIAL);
    expect(launcher.credits()).toBe(INITIAL);

    // Target: the player's own spawn tile — this keeps the test focused on
    // the cost deduction and spawn behaviour rather than travel logic.
    const target = game.ref(5, 5);
    game.addExecution(new ScoutSwarmExecution(launcher, target));

    // One tick is enough for the execution's init() to fire and deduct.
    game.executeNextTick();

    // 10% of 1000 = 100. removeCredits is a bigint subtract, so the
    // resulting balance must be exactly 900.
    expect(launcher.credits()).toBe(900n);
  });

  test("rounds down when the 10% is not an integer", () => {
    launcher.removeCredits(launcher.credits());
    launcher.addCredits(999n);

    const target = game.ref(5, 5);
    game.addExecution(new ScoutSwarmExecution(launcher, target));
    game.executeNextTick();

    // 10% of 999 = 99.9 → Math.floor → 99 deducted → 900 remaining.
    expect(launcher.credits()).toBe(900n);
  });

  test("spawns an active ScoutSwarm unit on an owned tile", () => {
    launcher.addCredits(500n);
    const target = game.ref(5, 5);
    game.addExecution(new ScoutSwarmExecution(launcher, target));
    game.executeNextTick();

    const swarms = launcher.units(UnitType.ScoutSwarm);
    expect(swarms).toHaveLength(1);
    expect(swarms[0].isActive()).toBe(true);
  });
});

describe("ScoutSwarmExecution — travel + arrival", () => {
  beforeEach(async () => {
    await buildGame();
  });

  test("dissolves on arrival at the target tile", () => {
    // Use a target that is literally the spawn tile so the scout arrives
    // on the very first tick — the execution's arrival branch still runs
    // but no fractional stepping is required.
    launcher.addCredits(500n);
    const target = game.ref(5, 5);
    game.addExecution(new ScoutSwarmExecution(launcher, target));

    // init() on tick 1 — scout spawned on `target`, tick() immediately
    // detects current === target and calls onArrival, which deletes.
    executeTicks(game, 2);

    expect(launcher.units(UnitType.ScoutSwarm)).toHaveLength(0);
  });

  test("shared per-tile terraform progress is bumped on each arrival", () => {
    launcher.addCredits(5000n);
    const target = game.ref(5, 5);

    // Fire three scouts at the same tile. After each dissolves the shared
    // counter should tick up by one. None of these should reach the default
    // accumulation threshold (10).
    for (let i = 0; i < 3; i++) {
      game.addExecution(new ScoutSwarmExecution(launcher, target));
      executeTicks(game, 2);
    }

    expect(game.scoutSwarmTerraformProgress(target)).toBe(3);
  });
});

describe("ScoutSwarmExecution — terraforming", () => {
  beforeEach(async () => {
    await buildGame();
  });

  test("asteroid field steps down to nebula after threshold arrivals", () => {
    // Find any AsteroidField sector tile on the map. If none exists on
    // big_plains we fall back to forcing one via setTerrainType so the
    // test always exercises the AsteroidField → Nebula branch.
    let asteroidTile = findTileWithTerrain(game, TerrainType.AsteroidField);
    if (asteroidTile === null) {
      asteroidTile = findTileWithTerrain(game, TerrainType.OpenSpace);
      if (asteroidTile === null) {
        throw new Error("no sector tile available on big_plains");
      }
      game.map().setTerrainType(asteroidTile, TerrainType.AsteroidField);
    }
    expect(game.map().terrainType(asteroidTile)).toBe(
      TerrainType.AsteroidField,
    );

    launcher.addCredits(100_000n);
    const threshold = game.config().scoutSwarmTerraformAccumulation();

    // Fire `threshold` scouts one-by-one. Each dissolves on arrival and
    // bumps the shared counter; the last one trips the terraform step.
    for (let i = 0; i < threshold; i++) {
      game.addExecution(new ScoutSwarmExecution(launcher, asteroidTile));
      // Give the scout enough ticks to path to the target. The big_plains
      // map is ~200 tiles across; scout speed is ~1/3 tile/tick so the
      // worst case is a few hundred ticks. We cap at 2000 here to be safe
      // but bail out as soon as the scout arrives.
      for (let t = 0; t < 2000; t++) {
        game.executeNextTick();
        if (launcher.units(UnitType.ScoutSwarm).length === 0) {
          break;
        }
      }
    }

    // After `threshold` arrivals the tile's terrain should have stepped
    // from AsteroidField to Nebula and the shared counter should have been
    // reset back to zero.
    expect(game.map().terrainType(asteroidTile)).toBe(TerrainType.Nebula);
    expect(game.scoutSwarmTerraformProgress(asteroidTile)).toBe(0);
  });

  test("nebula steps down to open space after threshold arrivals", () => {
    let tile = findTileWithTerrain(game, TerrainType.Nebula);
    if (tile === null) {
      tile = findTileWithTerrain(game, TerrainType.OpenSpace);
      if (tile === null) {
        throw new Error("no sector tile available on big_plains");
      }
      game.map().setTerrainType(tile, TerrainType.Nebula);
    }
    expect(game.map().terrainType(tile)).toBe(TerrainType.Nebula);

    launcher.addCredits(100_000n);
    const threshold = game.config().scoutSwarmTerraformAccumulation();

    for (let i = 0; i < threshold; i++) {
      game.addExecution(new ScoutSwarmExecution(launcher, tile));
      for (let t = 0; t < 2000; t++) {
        game.executeNextTick();
        if (launcher.units(UnitType.ScoutSwarm).length === 0) {
          break;
        }
      }
    }

    expect(game.map().terrainType(tile)).toBe(TerrainType.OpenSpace);
  });

  test("open space is a no-op (already fully habitable)", () => {
    const tile = findTileWithTerrain(game, TerrainType.OpenSpace);
    if (tile === null) {
      throw new Error("no OpenSpace sector tile available on big_plains");
    }

    launcher.addCredits(100_000n);
    const threshold = game.config().scoutSwarmTerraformAccumulation();

    for (let i = 0; i < threshold; i++) {
      game.addExecution(new ScoutSwarmExecution(launcher, tile));
      for (let t = 0; t < 2000; t++) {
        game.executeNextTick();
        if (launcher.units(UnitType.ScoutSwarm).length === 0) {
          break;
        }
      }
    }

    // OpenSpace can't be upgraded further. The threshold *was* hit so
    // the progress map is reset (applyTerraformStep returns early before
    // setTerrainType), but the terrain is unchanged.
    expect(game.map().terrainType(tile)).toBe(TerrainType.OpenSpace);
  });
});

/**
 * Scan the map for the first sector tile whose current terrainType matches
 * `want`. Returns null when none exist (some test maps are uniform) — the
 * caller is expected to fall back to setTerrainType in that case.
 */
function findTileWithTerrain(game: Game, want: TerrainType) {
  const width = game.width();
  const height = game.height();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = game.ref(x, y);
      if (!game.map().isSector(tile)) continue;
      if (game.map().terrainType(tile) === want) {
        return tile;
      }
    }
  }
  return null;
}
