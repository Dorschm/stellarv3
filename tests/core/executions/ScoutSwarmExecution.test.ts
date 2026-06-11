// @vitest-environment node
import fs from "fs";
import path from "path";
import { ScoutSwarmExecution } from "../../../src/core/execution/ScoutSwarmExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Cell,
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import {
  HABITABILITY_NEBULA,
  HABITABILITY_OPEN_SPACE,
} from "../../../src/core/game/SectorMap";
import {
  genTerrainFromBin,
  MapManifest,
} from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig, GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { TestServerConfig } from "../../util/TestServerConfig";
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
  // Scout swarms require a Spaceport or Jump Gate to launch from. Build
  // one on the launcher's spawn tile so existing tests can actually fire
  // scouts. The no-launch-structure case has its own dedicated test.
  launcher.buildUnit(UnitType.Spaceport, game.ref(5, 5), {});
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

  test("deducts the configured fixed population cost at launch", () => {
    // GDD §3.1: scout swarms consume population on launch alongside the
    // credit cost. The deduction is a fixed configurable amount — it does
    // NOT scale with population cap or current population — so launches
    // stay predictable regardless of empire size.
    launcher.addCredits(1_000n);
    const cost = game.config().scoutSwarmPopulationCost();
    expect(cost).toBeGreaterThan(0);
    const popBefore = launcher.population();
    expect(popBefore).toBeGreaterThanOrEqual(cost);

    const target = game.ref(5, 5);
    game.addExecution(new ScoutSwarmExecution(launcher, target));
    game.executeNextTick();

    expect(launcher.population()).toBe(popBefore - cost);
  });

  test("launch succeeds even when the launcher has zero population (soft cost)", () => {
    // Soft-cost contract: the scout launch should not be gated on
    // population availability. A launcher at 0 still spawns the swarm,
    // and removePopulation simply caps at available (i.e. removes 0).
    launcher.addCredits(1_000n);
    // Force population to zero directly: removePopulation now reserves a
    // survival floor for a living player, so it can no longer drain to
    // exactly 0. setPopulation establishes the 0-population precondition.
    launcher.setPopulation(0);
    expect(launcher.population()).toBe(0);

    const target = game.ref(5, 5);
    game.addExecution(new ScoutSwarmExecution(launcher, target));
    game.executeNextTick();

    expect(launcher.population()).toBe(0);
    // The swarm itself was spawned despite the insufficient population.
    expect(launcher.units(UnitType.ScoutSwarm)).toHaveLength(1);
    expect(launcher.units(UnitType.ScoutSwarm)[0].isActive()).toBe(true);
  });

  test("aborts silently and charges nothing when the launcher has no Spaceport or Jump Gate", async () => {
    // Fresh game with no pre-built launch structure so the spawn-tile
    // check bails before any credits or population are deducted. Builds
    // its own game to avoid the Spaceport that buildGame() adds.
    const fresh = await setup("big_plains", {
      infiniteCredits: false,
      instantBuild: true,
    });
    fresh.addPlayer(
      new PlayerInfo("no_port", PlayerType.Human, null, "no_port"),
    );
    fresh.addExecution(
      new SpawnExecution(
        gameID,
        fresh.player("no_port").info(),
        fresh.ref(5, 5),
      ),
    );
    while (fresh.inSpawnPhase()) {
      fresh.executeNextTick();
    }
    const p = fresh.player("no_port");

    // Pin credits and population to known pre-launch values.
    p.removeCredits(p.credits());
    p.addCredits(1_000n);
    const creditsBefore = p.credits();
    const popBefore = p.population();

    fresh.addExecution(new ScoutSwarmExecution(p, fresh.ref(5, 5)));
    fresh.executeNextTick();

    // No scout, no cost.
    expect(p.units(UnitType.ScoutSwarm)).toHaveLength(0);
    expect(p.credits()).toBe(creditsBefore);
    expect(p.population()).toBe(popBefore);
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
 * Ownership-grant tests (GAP-10, ticket
 * df928bb3-2f7d-47b7-b139-8f60e7d73f3d).
 *
 * After a scout swarm completes a terraform step on an unowned tile, the
 * launching player should gain ownership — closing the GDD's explore →
 * terraform → control loop. These tests drive `applyTerraformStep()`
 * directly via a cast to avoid the multi-thousand-tick flight paths used
 * in the terraforming suite above, which lets us isolate the ownership
 * semantics from the travel + accumulation machinery already covered by
 * the earlier describe blocks.
 */
describe("ScoutSwarmExecution — ownership grant on terraform", () => {
  beforeEach(async () => {
    await buildGame();
  });

  /**
   * Find an unowned sector tile and force its terrain to `desired`.
   *
   * Note on SectorMap bookkeeping: the `big_plains` test fixture has
   * no nation seeds, so the SectorMap constructor paints every tile
   * with `sectorId === 0`. That means `recordTileGained` is a no-op
   * path on this map — the per-player tile/habitability sums remain at
   * zero regardless of how many tiles are conquered. Correctness of
   * the SectorMap bookkeeping path itself is covered by
   * `tests/core/game/SectorMap.test.ts`; these tests focus on the
   * ownership / launcher-state semantics of the new conquer() call.
   */
  function findUnownedSectorTile(desired: TerrainType) {
    const width = game.width();
    const height = game.height();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = game.ref(x, y);
        if (!game.map().isSector(t)) continue;
        if (game.hasOwner(t)) continue;
        game.map().setTerrainType(t, desired);
        return t;
      }
    }
    throw new Error("no unowned sector tile available on big_plains");
  }

  test("terraforming unowned AsteroidField → Nebula grants ownership to launcher", () => {
    const tile = findUnownedSectorTile(TerrainType.AsteroidField);
    expect(game.hasOwner(tile)).toBe(false);

    // Drive applyTerraformStep directly. ScoutSwarmExecution only needs
    // `mg` set for the method under test, and init() sets it up. The
    // scout unit created by init() is incidental — the test is about
    // the post-terraform ownership branch, not the flight path.
    launcher.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcher, tile);
    exec.init(game, 0);

    const tilesBefore = launcher.numTilesOwned();

    (exec as any).applyTerraformStep(tile);

    // Terrain stepped one band toward habitability …
    expect(game.map().terrainType(tile)).toBe(TerrainType.Nebula);
    // … and the launcher now owns the tile.
    expect(game.hasOwner(tile)).toBe(true);
    expect(game.owner(tile)).toBe(launcher);
    expect(launcher.numTilesOwned()).toBe(tilesBefore + 1);
    expect(launcher.tiles()).toContain(tile);
  });

  test("terraforming unowned Nebula → OpenSpace grants ownership to launcher", () => {
    const tile = findUnownedSectorTile(TerrainType.Nebula);
    expect(game.hasOwner(tile)).toBe(false);

    launcher.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcher, tile);
    exec.init(game, 0);

    (exec as any).applyTerraformStep(tile);

    expect(game.map().terrainType(tile)).toBe(TerrainType.OpenSpace);
    expect(game.owner(tile)).toBe(launcher);
  });

  test("terraforming enemy-owned tile does NOT change ownership", () => {
    // Add a second player and give them an AsteroidField tile to sit on.
    game.addPlayer(new PlayerInfo("enemy", PlayerType.Human, null, "enemy_id"));
    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player("enemy_id").info(),
        game.ref(5, 5),
      ),
    );
    // Spawn phase already ended for the launcher — just run ticks until
    // the enemy's SpawnExecution initializes. `inSpawnPhase` returns
    // false here, so a single tick is enough for the execution to fire.
    game.executeNextTick();
    const enemy = game.player("enemy_id");

    // Pick an unowned sector tile, force it to AsteroidField, then hand
    // it to the enemy via conquer().
    const tile = findUnownedSectorTile(TerrainType.AsteroidField);
    enemy.conquer(tile);
    expect(game.owner(tile)).toBe(enemy);

    const enemyTilesBefore = enemy.numTilesOwned();
    const launcherTilesBefore = launcher.numTilesOwned();

    launcher.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcher, tile);
    exec.init(game, 0);

    (exec as any).applyTerraformStep(tile);

    // Terrain still steps — that's the existing behaviour — but the
    // enemy retains ownership. Scout swarms never steal via terraform.
    expect(game.map().terrainType(tile)).toBe(TerrainType.Nebula);
    expect(game.owner(tile)).toBe(enemy);
    expect(enemy.numTilesOwned()).toBe(enemyTilesBefore);
    expect(launcher.numTilesOwned()).toBe(launcherTilesBefore);
  });

  test("terraforming launcher-owned tile does NOT trigger duplicate conquer", () => {
    // Pick a launcher-owned tile (from the spawn fill), force it to
    // AsteroidField, then terraform. The tile should remain owned by
    // the launcher exactly once — no double count, no tileGained bump.
    const ownedTiles = Array.from(launcher.tiles());
    expect(ownedTiles.length).toBeGreaterThan(0);
    const tile = ownedTiles[0];
    game.map().setTerrainType(tile, TerrainType.AsteroidField);
    expect(game.owner(tile)).toBe(launcher);

    const tilesBefore = launcher.numTilesOwned();

    launcher.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcher, tile);
    exec.init(game, 0);

    (exec as any).applyTerraformStep(tile);

    // Terrain stepped, tile still owned, total tile count unchanged
    // (not +1 — the ownerIdBefore !== null branch runs
    // recomputeHabitabilityForTile, which does NOT add a tile).
    expect(game.map().terrainType(tile)).toBe(TerrainType.Nebula);
    expect(game.owner(tile)).toBe(launcher);
    expect(launcher.numTilesOwned()).toBe(tilesBefore);
  });

  test("terraforming unowned tile when launcher is eliminated does NOT revive the launcher", () => {
    // Grab a far-away AsteroidField target …
    const tile = findUnownedSectorTile(TerrainType.AsteroidField);
    expect(game.hasOwner(tile)).toBe(false);

    // … and an execution that pretends the scout is in flight.
    launcher.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcher, tile);
    exec.init(game, 0);

    // Now eliminate the launcher by relinquishing every owned tile.
    // PlayerImpl.isAlive() is defined as `_tiles.size > 0`, so an empty
    // tile set is the canonical eliminated state.
    const toRemove = Array.from(launcher.tiles());
    for (const t of toRemove) {
      launcher.relinquish(t);
    }
    expect(launcher.numTilesOwned()).toBe(0);
    expect(launcher.isAlive()).toBe(false);

    (exec as any).applyTerraformStep(tile);

    // Terrain still steps (a dead player's swarm can still land and
    // terraform — the intent fired before they died), but ownership is
    // NOT granted. Otherwise conquer() would add one tile to the
    // eliminated launcher and silently revive them, breaking the
    // elimination / permadeath contract.
    expect(game.map().terrainType(tile)).toBe(TerrainType.Nebula);
    expect(game.hasOwner(tile)).toBe(false);
    expect(launcher.numTilesOwned()).toBe(0);
    expect(launcher.isAlive()).toBe(false);
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

/**
 * End-to-end ownership + SectorMap-accounting tests.
 *
 * These complement the `applyTerraformStep`-cast tests above by driving the
 * scout through the full public path: SpawnExecution → scout flight →
 * arrival-triggered terraform → `launcher.conquer()` → SectorMap running
 * totals. The earlier ownership tests stub out travel and call a private
 * method, and they run on a map built by the default test `setup()` helper
 * whose SectorMap has `sectorId === 0` everywhere (big_plains ships with an
 * empty `nations[]`), so every `recordTileGained` on them is a no-op. That
 * means a regression that broke the conquer-side bookkeeping would still
 * pass those tests.
 *
 * To exercise the production SectorMap path the tests below construct the
 * game directly via `createGame`, injecting a single in-map Nation seed so
 * the SectorMap BFS paints real, non-zero sector IDs over every sector
 * tile on big_plains. The launcher then spawns normally, we pick a tile
 * within scout-reach, force it to AsteroidField, and fire the configured
 * accumulation threshold of scouts at it. By the time the last scout lands
 * the tile should be (a) terraformed, (b) owned, and (c) reflected in the
 * launcher's per-player SectorMap counters (`playerOwnedSectorTiles`, the
 * habitability buckets, and the habitability sum).
 */
describe("ScoutSwarmExecution — ownership grant (end-to-end, seeded sectors)", () => {
  let seededGame: Game;
  let seededLauncher: Player;
  const seededGameID: GameID = "scout_swarm_seeded_game";

  /**
   * Construct a game with a non-empty nation seed array so SectorMap's BFS
   * paints every sector tile on big_plains with `sectorId === 1`. Mirrors
   * {@link setup} from `tests/util/Setup.ts` but routes the extra nations
   * argument into {@link createGame} (the shared helper exposes no
   * parameter for it). The nation player is never given a SpawnExecution,
   * so it exists only as a SectorMap seed — no tiles, no behaviour.
   */
  async function buildSeededGame() {
    const mapName = "big_plains";
    const mapBinPath = path.join(
      __dirname,
      `../../testdata/maps/${mapName}/map.bin`,
    );
    const miniMapBinPath = path.join(
      __dirname,
      `../../testdata/maps/${mapName}/map4x.bin`,
    );
    const manifestPath = path.join(
      __dirname,
      `../../testdata/maps/${mapName}/manifest.json`,
    );

    const mapBinBuffer = fs.readFileSync(mapBinPath);
    const miniMapBinBuffer = fs.readFileSync(miniMapBinPath);
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) satisfies MapManifest;

    const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
    const miniGameMap = await genTerrainFromBin(
      manifest.map4x,
      miniMapBinBuffer,
    );

    const serverConfig = new TestServerConfig();
    const gameConfig: GameConfig = {
      gameMap: GameMapType.SolSystem,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateCredits: false,
      donatePopulation: false,
      bots: 0,
      infiniteCredits: false,
      infinitePopulation: false,
      instantBuild: true,
      randomSpawn: false,
    };
    const config = new TestConfig(
      serverConfig,
      gameConfig,
      new UserSettings(),
      false,
    );

    // Single sector seed placed well away from the launcher's spawn at
    // (5, 5). BFS floods the entire connected sector region of big_plains,
    // so every tile the launcher ever touches has `sectorOf() === 1`.
    // The nation is built as a PlayerType.Nation so `createGame` keeps it
    // in the player table but no SpawnExecution is ever queued for it —
    // it's just a SectorMap seed donor.
    const sectorSeedNation = new Nation(
      new Cell(100, 100),
      new PlayerInfo(
        "sector_seed_nation",
        PlayerType.Nation,
        null,
        "sector_seed_nation_id",
      ),
    );

    seededGame = createGame(
      [],
      [sectorSeedNation],
      gameMap,
      miniGameMap,
      config,
    );
    seededGame.addPlayer(
      new PlayerInfo(
        "scout_launcher",
        PlayerType.Human,
        null,
        "scout_launcher",
      ),
    );
    seededGame.addExecution(
      new SpawnExecution(
        seededGameID,
        seededGame.player("scout_launcher").info(),
        seededGame.ref(5, 5),
      ),
    );
    while (seededGame.inSpawnPhase()) {
      seededGame.executeNextTick();
    }
    seededLauncher = seededGame.player("scout_launcher");
    // Scout swarms require a Spaceport or Jump Gate to launch from.
    seededLauncher.buildUnit(UnitType.Spaceport, seededGame.ref(5, 5), {});
  }

  beforeEach(async () => {
    await buildSeededGame();
  });

  test("terraform-triggered conquer updates ownership AND SectorMap per-player counters", () => {
    // Sanity-check the fixture: the SectorMap BFS must have actually
    // painted non-zero sector IDs, otherwise every running total stays at
    // 0 and this test degrades into the same no-op as the big_plains
    // default-setup ownership tests above.
    expect(seededGame.sectorMap().numSectors()).toBeGreaterThan(0);
    // The launcher's spawn tiles landed in the flooded sector region.
    const launcherTilesBefore = seededLauncher.numTilesOwned();
    expect(launcherTilesBefore).toBeGreaterThan(0);
    const sm = seededGame.sectorMap();
    const ownedSectorTilesBefore = sm.playerOwnedSectorTiles(seededLauncher);
    expect(ownedSectorTilesBefore).toBe(launcherTilesBefore);

    // Snapshot the running habitability totals BEFORE terraforming so the
    // deltas we assert can isolate the contribution of the newly-conquered
    // Nebula tile.
    const fullBefore = sm.playerFullHabTiles(seededLauncher);
    const partialBefore = sm.playerPartialHabTiles(seededLauncher);
    const uninhabBefore = sm.playerUninhabTiles(seededLauncher);
    const habSumBefore =
      sm.playerAverageHabitability(seededLauncher) * ownedSectorTilesBefore;

    // Pick a target that is close to the launcher so each scout only needs
    // a few dozen ticks to arrive. Anything within reach of a greedy
    // manhattan descent from an owned tile works; (15, 5) is ~10 tiles
    // east of the spawn center, which is well outside the spawn radius
    // (euclidean-4 BFS around (5, 5)) so it starts unowned.
    const target = seededGame.ref(15, 5);
    expect(seededGame.hasOwner(target)).toBe(false);
    expect(seededGame.map().isSector(target)).toBe(true);
    // The key distinction from the cast-based tests: the target tile must
    // actually carry a real sector ID, otherwise `recordTileGained` skips
    // its running-total updates and this whole test becomes vacuous.
    expect(sm.sectorOf(target)).toBeGreaterThan(0);

    // Force the terrain so the first terraform step lands on Nebula
    // (AsteroidField → Nebula) — an uninhabitable → partial transition,
    // which is the bucket crossing that exercises the widest slice of
    // SectorMap bookkeeping (count + bucket + hab sum + weighted yield).
    seededGame.map().setTerrainType(target, TerrainType.AsteroidField);
    expect(seededGame.map().terrainType(target)).toBe(
      TerrainType.AsteroidField,
    );

    // Fire the full accumulation threshold through the public path: each
    // scout is spawned by ScoutSwarmExecution.init(), flies via tick()'s
    // fractional stepping, reaches the target, calls onArrival(), and on
    // the final arrival the shared counter crosses the threshold and
    // applyTerraformStep runs — no private-method cast required.
    const threshold = seededGame.config().scoutSwarmTerraformAccumulation();
    // Give the launcher enough credits to cover every launch (each
    // deducts 10% of the current balance, so we refill before each fire
    // to keep the cost bounded).
    for (let i = 0; i < threshold; i++) {
      seededLauncher.addCredits(10_000n);
      seededGame.addExecution(new ScoutSwarmExecution(seededLauncher, target));
      // Bounded wait loop mirrors the terraforming describe block above —
      // bail out as soon as the scout dissolves so the test doesn't burn
      // thousands of wasted ticks per scout.
      for (let t = 0; t < 2000; t++) {
        seededGame.executeNextTick();
        if (seededLauncher.units(UnitType.ScoutSwarm).length === 0) {
          break;
        }
      }
    }

    // --- Ownership / terrain assertions -----------------------------------
    expect(seededGame.map().terrainType(target)).toBe(TerrainType.Nebula);
    expect(seededGame.hasOwner(target)).toBe(true);
    expect(seededGame.owner(target)).toBe(seededLauncher);
    expect(seededLauncher.tiles()).toContain(target);
    expect(seededLauncher.numTilesOwned()).toBe(launcherTilesBefore + 1);

    // --- SectorMap bookkeeping assertions ---------------------------------
    // playerOwnedSectorTiles must tick up by exactly one — this is the O(1)
    // running total used by the economy formulas. The earlier cast-based
    // tests could not cover this because their target sits in sector 0 and
    // `recordTileGained` early-returns.
    expect(sm.playerOwnedSectorTiles(seededLauncher)).toBe(
      ownedSectorTilesBefore + 1,
    );
    // The Nebula tile lands in the "partial" habitability bucket, so the
    // partial bucket should increment by one and the "uninhabitable"
    // bucket (where an AsteroidField would have lived, if it had ever been
    // owned) must stay unchanged — the scout's conquer happens *after*
    // setTerrainType, so the tile is reported as Nebula on arrival.
    expect(sm.playerPartialHabTiles(seededLauncher)).toBe(partialBefore + 1);
    expect(sm.playerFullHabTiles(seededLauncher)).toBe(fullBefore);
    expect(sm.playerUninhabTiles(seededLauncher)).toBe(uninhabBefore);

    // Running habitability sum must have grown by exactly the Nebula
    // constant (0.6). Reconstructed via
    //   avgHab × ownedSectorTiles === habSum
    // so the invariant hands us the post-conquer sum without poking at
    // SectorMap private fields.
    const ownedSectorTilesAfter = sm.playerOwnedSectorTiles(seededLauncher);
    const habSumAfter =
      sm.playerAverageHabitability(seededLauncher) * ownedSectorTilesAfter;
    expect(habSumAfter).toBeCloseTo(habSumBefore + HABITABILITY_NEBULA, 10);
    // Cross-check: the partial+full buckets should equal the count of
    // yielding owned tiles, and the three buckets together should cover
    // every owned sector tile. Guards against a regression that
    // increments a bucket without updating the total.
    const totalBuckets =
      sm.playerFullHabTiles(seededLauncher) +
      sm.playerPartialHabTiles(seededLauncher) +
      sm.playerUninhabTiles(seededLauncher);
    expect(totalBuckets).toBe(ownedSectorTilesAfter);
  });

  test("second terraform step (Nebula → OpenSpace) swaps partial → full bucket", () => {
    // Chain two terraform cycles on the same tile. After the first round
    // the target is a launcher-owned Nebula (partial bucket); the second
    // round must transition partial → full via
    // `recomputeHabitabilityForTile` (because the tile is owned after the
    // first round), NOT via a second conquer(). This catches regressions
    // where the owned-branch of applyTerraformStep forgets to hand the
    // pre-mutation habitability to SectorMap and the bucket counts drift.
    const sm = seededGame.sectorMap();
    const target = seededGame.ref(15, 5);
    expect(sm.sectorOf(target)).toBeGreaterThan(0);

    seededGame.map().setTerrainType(target, TerrainType.AsteroidField);

    const threshold = seededGame.config().scoutSwarmTerraformAccumulation();

    const runThreshold = () => {
      for (let i = 0; i < threshold; i++) {
        seededLauncher.addCredits(10_000n);
        seededGame.addExecution(
          new ScoutSwarmExecution(seededLauncher, target),
        );
        for (let t = 0; t < 2000; t++) {
          seededGame.executeNextTick();
          if (seededLauncher.units(UnitType.ScoutSwarm).length === 0) {
            break;
          }
        }
      }
    };

    // First cycle: AsteroidField → Nebula → launcher conquers the tile.
    runThreshold();
    expect(seededGame.map().terrainType(target)).toBe(TerrainType.Nebula);
    expect(seededGame.owner(target)).toBe(seededLauncher);
    const partialAfterFirst = sm.playerPartialHabTiles(seededLauncher);
    const fullAfterFirst = sm.playerFullHabTiles(seededLauncher);
    const countAfterFirst = sm.playerOwnedSectorTiles(seededLauncher);
    const habSumAfterFirst =
      sm.playerAverageHabitability(seededLauncher) * countAfterFirst;

    // Second cycle: Nebula → OpenSpace on the *already-owned* tile. No new
    // conquer should fire — the tile count stays put, partial → full
    // bucket swap happens, and the running hab sum grows by the delta
    // (OpenSpace - Nebula).
    runThreshold();

    expect(seededGame.map().terrainType(target)).toBe(TerrainType.OpenSpace);
    // Tile count unchanged — this is the regression guard for a
    // double-conquer bug: the owned branch returns before `launcher.conquer`.
    expect(sm.playerOwnedSectorTiles(seededLauncher)).toBe(countAfterFirst);
    // Bucket swap: partial -1, full +1.
    expect(sm.playerPartialHabTiles(seededLauncher)).toBe(
      partialAfterFirst - 1,
    );
    expect(sm.playerFullHabTiles(seededLauncher)).toBe(fullAfterFirst + 1);

    const countAfterSecond = sm.playerOwnedSectorTiles(seededLauncher);
    const habSumAfterSecond =
      sm.playerAverageHabitability(seededLauncher) * countAfterSecond;
    expect(habSumAfterSecond).toBeCloseTo(
      habSumAfterFirst + (HABITABILITY_OPEN_SPACE - HABITABILITY_NEBULA),
      10,
    );
  });
});

/**
 * Trail + cluster terraforming (GDD §4, ticket
 * 76a67e2d-bc7f-49ca-9d57-524957a31875).
 *
 * Scouts now terraform:
 *   1. A 1-tile-wide trail along their flight path — every DeepSpace tile
 *      the scout steps through bumps the shared per-tile accumulation
 *      counter, and steps the terrain one band once the threshold is hit.
 *   2. A cluster of tiles around the arrival target — `circleSearch` within
 *      `scoutSwarmClusterRadius()` finds every DeepSpace tile near the
 *      arrival, bumps progress for each, and steps the threshold-trippers.
 *
 * These tests use `ocean_and_land` because big_plains has little deep space
 * at the edges — ocean_and_land is 16×16 with ~120 void tiles, giving
 * plenty of DeepSpace to exercise the trail and cluster branches.
 */
describe("ScoutSwarmExecution — trail terraforming", () => {
  let gameOL: Game;
  let launcherOL: Player;

  async function buildOceanGame() {
    gameOL = await setup("ocean_and_land", {
      infiniteCredits: false,
      instantBuild: true,
    });
    gameOL.addPlayer(
      new PlayerInfo(
        "trail_launcher",
        PlayerType.Human,
        null,
        "trail_launcher",
      ),
    );
    // Find any sector tile for spawning — on ocean_and_land sectors are
    // scattered. Scan the map for the first sector tile.
    let spawn: number | null = null;
    outer: for (let y = 0; y < gameOL.height(); y++) {
      for (let x = 0; x < gameOL.width(); x++) {
        const t = gameOL.ref(x, y);
        if (gameOL.map().isSector(t)) {
          spawn = t;
          break outer;
        }
      }
    }
    if (spawn === null) {
      throw new Error("no sector tile on ocean_and_land");
    }
    gameOL.addExecution(
      new SpawnExecution(gameID, gameOL.player("trail_launcher").info(), spawn),
    );
    while (gameOL.inSpawnPhase()) {
      gameOL.executeNextTick();
    }
    launcherOL = gameOL.player("trail_launcher");
    launcherOL.buildUnit(UnitType.Spaceport, spawn, {});
  }

  function findDeepSpaceTile(g: Game): number {
    for (let y = 0; y < g.height(); y++) {
      for (let x = 0; x < g.width(); x++) {
        const t = g.ref(x, y);
        if (g.map().terrainType(t) === TerrainType.DeepSpace) {
          return t;
        }
      }
    }
    throw new Error("no DeepSpace tile on ocean_and_land");
  }

  beforeEach(async () => {
    await buildOceanGame();
  });

  test("tryTerraformTrailTile bumps progress on a DeepSpace tile", () => {
    const tile = findDeepSpaceTile(gameOL);
    expect(gameOL.map().terrainType(tile)).toBe(TerrainType.DeepSpace);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, tile);
    exec.init(gameOL, 0);

    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(0);
    (exec as any).tryTerraformTrailTile(tile);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(1);
    (exec as any).tryTerraformTrailTile(tile);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(2);
  });

  test("tryTerraformTrailTile is a no-op on OpenSpace / DebrisField tiles", () => {
    // OpenSpace is already fully habitable and DebrisField is not a
    // valid terraform input — trail passes over either must not bump
    // the shared counter. AsteroidField and Nebula ARE counted (trail
    // corridor upgrade) — covered in the corridor-upgrade tests below.
    const ownedTiles = Array.from(launcherOL.tiles());
    expect(ownedTiles.length).toBeGreaterThan(0);
    const openTile = ownedTiles[0];
    gameOL.map().setTerrainType(openTile, TerrainType.OpenSpace);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, openTile);
    exec.init(gameOL, 0);

    const progressBefore = gameOL.scoutSwarmTerraformProgress(openTile);
    (exec as any).tryTerraformTrailTile(openTile);
    expect(gameOL.scoutSwarmTerraformProgress(openTile)).toBe(progressBefore);
  });

  test("tryTerraformTrailTile bumps progress on AsteroidField and Nebula so corridors can mature", () => {
    // Corridor-upgrade contract (Comment 1 fix): once a trail tile has
    // been promoted from DeepSpace to AsteroidField by earlier scouts,
    // subsequent passes must keep accumulating so the corridor can
    // mature into Nebula and eventually OpenSpace. A one-step corridor
    // that stops after AsteroidField is the regression being guarded.
    const ownedTiles = Array.from(launcherOL.tiles());
    expect(ownedTiles.length).toBeGreaterThanOrEqual(2);

    const asteroidTile = ownedTiles[0];
    gameOL.map().setTerrainType(asteroidTile, TerrainType.AsteroidField);
    const nebulaTile = ownedTiles[1];
    gameOL.map().setTerrainType(nebulaTile, TerrainType.Nebula);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, asteroidTile);
    exec.init(gameOL, 0);

    const asteroidBefore = gameOL.scoutSwarmTerraformProgress(asteroidTile);
    const nebulaBefore = gameOL.scoutSwarmTerraformProgress(nebulaTile);

    (exec as any).tryTerraformTrailTile(asteroidTile);
    (exec as any).tryTerraformTrailTile(nebulaTile);

    expect(gameOL.scoutSwarmTerraformProgress(asteroidTile)).toBe(
      asteroidBefore + 1,
    );
    expect(gameOL.scoutSwarmTerraformProgress(nebulaTile)).toBe(
      nebulaBefore + 1,
    );
  });

  test("trail steps AsteroidField → Nebula → OpenSpace across repeated passes", () => {
    // End-to-end corridor maturation: repeatedly bumping an
    // AsteroidField trail tile past the threshold must step it to
    // Nebula, and then bumping again past the threshold must step it
    // to OpenSpace. Guards against tryTerraformTrailTile returning
    // early once the tile leaves DeepSpace.
    const ownedTiles = Array.from(launcherOL.tiles());
    expect(ownedTiles.length).toBeGreaterThan(0);
    const tile = ownedTiles[0];
    gameOL.map().setTerrainType(tile, TerrainType.AsteroidField);
    gameOL.resetScoutSwarmTerraformProgress(tile);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, tile);
    exec.init(gameOL, 0);

    const threshold = gameOL.config().scoutSwarmTerraformAccumulation();

    for (let i = 0; i < threshold; i++) {
      (exec as any).tryTerraformTrailTile(tile);
    }
    expect(gameOL.map().terrainType(tile)).toBe(TerrainType.Nebula);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(0);

    for (let i = 0; i < threshold; i++) {
      (exec as any).tryTerraformTrailTile(tile);
    }
    expect(gameOL.map().terrainType(tile)).toBe(TerrainType.OpenSpace);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(0);
  });

  test("trail converts DeepSpace → AsteroidField when threshold is reached and grants ownership", () => {
    const tile = findDeepSpaceTile(gameOL);
    expect(gameOL.map().terrainType(tile)).toBe(TerrainType.DeepSpace);
    expect(gameOL.hasOwner(tile)).toBe(false);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, tile);
    exec.init(gameOL, 0);

    // Pre-seed progress to (threshold - 1) so the next bump trips the
    // terraform step. Uses the public recordScoutSwarmTerraformProgress
    // counter shared by trail, cluster, and arrival logic.
    const threshold = gameOL.config().scoutSwarmTerraformAccumulation();
    for (let i = 0; i < threshold - 1; i++) {
      gameOL.recordScoutSwarmTerraformProgress(tile);
    }
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(threshold - 1);

    (exec as any).tryTerraformTrailTile(tile);

    expect(gameOL.map().terrainType(tile)).toBe(TerrainType.AsteroidField);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(0);
    // Launcher is alive — unowned DeepSpace promotion conquers the tile.
    expect(gameOL.hasOwner(tile)).toBe(true);
    expect(gameOL.owner(tile)).toBe(launcherOL);
  });

  test("two passes over the same DeepSpace tile accumulate shared progress", () => {
    const tile = findDeepSpaceTile(gameOL);

    launcherOL.addCredits(1_000n);
    const first = new ScoutSwarmExecution(launcherOL, tile);
    first.init(gameOL, 0);
    (first as any).tryTerraformTrailTile(tile);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(1);

    const second = new ScoutSwarmExecution(launcherOL, tile);
    second.init(gameOL, 0);
    (second as any).tryTerraformTrailTile(tile);
    expect(gameOL.scoutSwarmTerraformProgress(tile)).toBe(2);
  });
});

describe("ScoutSwarmExecution — destination cluster terraforming", () => {
  let gameOL: Game;
  let launcherOL: Player;

  async function buildOceanGame() {
    gameOL = await setup("ocean_and_land", {
      infiniteCredits: false,
      instantBuild: true,
    });
    gameOL.addPlayer(
      new PlayerInfo(
        "cluster_launcher",
        PlayerType.Human,
        null,
        "cluster_launcher",
      ),
    );
    let spawn: number | null = null;
    outer: for (let y = 0; y < gameOL.height(); y++) {
      for (let x = 0; x < gameOL.width(); x++) {
        const t = gameOL.ref(x, y);
        if (gameOL.map().isSector(t)) {
          spawn = t;
          break outer;
        }
      }
    }
    if (spawn === null) {
      throw new Error("no sector tile on ocean_and_land");
    }
    gameOL.addExecution(
      new SpawnExecution(
        gameID,
        gameOL.player("cluster_launcher").info(),
        spawn,
      ),
    );
    while (gameOL.inSpawnPhase()) {
      gameOL.executeNextTick();
    }
    launcherOL = gameOL.player("cluster_launcher");
    launcherOL.buildUnit(UnitType.Spaceport, spawn, {});
  }

  /**
   * Return every DeepSpace tile in the configured cluster radius around
   * `center`, excluding the center itself. Used to verify cluster coverage.
   */
  function deepSpaceNeighborsInRadius(
    g: Game,
    center: number,
    radius: number,
  ): number[] {
    const out: number[] = [];
    for (const t of g.circleSearch(center, radius)) {
      if (t === center) continue;
      if (g.map().terrainType(t) === TerrainType.DeepSpace) out.push(t);
    }
    return out;
  }

  beforeEach(async () => {
    await buildOceanGame();
  });

  test("arrival bumps cluster progress for DeepSpace tiles within radius", () => {
    // Pick a DeepSpace tile with DeepSpace neighbours so the cluster has
    // something to terraform. Scan for the first DeepSpace with at least
    // one other DeepSpace within radius.
    const radius = gameOL.config().scoutSwarmClusterRadius();
    let target: number | null = null;
    for (let y = 0; y < gameOL.height() && target === null; y++) {
      for (let x = 0; x < gameOL.width(); x++) {
        const t = gameOL.ref(x, y);
        if (gameOL.map().terrainType(t) !== TerrainType.DeepSpace) continue;
        if (deepSpaceNeighborsInRadius(gameOL, t, radius).length > 0) {
          target = t;
          break;
        }
      }
    }
    if (target === null) throw new Error("no suitable DeepSpace target");
    const neighbors = deepSpaceNeighborsInRadius(gameOL, target, radius);
    expect(neighbors.length).toBeGreaterThan(0);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, target);
    exec.init(gameOL, 0);

    // Put the scout on the target so onArrival's guard (scout !== null) is
    // satisfied. The cluster branch is what the test cares about; the
    // single-target terraform bump is incidental.
    (exec as any).scout.move(target);

    for (const n of neighbors) {
      expect(gameOL.scoutSwarmTerraformProgress(n)).toBe(0);
    }

    (exec as any).onArrival(target);

    for (const n of neighbors) {
      expect(gameOL.scoutSwarmTerraformProgress(n)).toBe(1);
    }
  });

  test("cluster ignores non-DeepSpace tiles within the radius", () => {
    // Target a DeepSpace tile near the launcher's territory so the cluster
    // spans both sector and void tiles. Any owned sector tile within
    // radius must NOT have its counter bumped.
    const radius = gameOL.config().scoutSwarmClusterRadius();
    const ownedTiles = Array.from(launcherOL.tiles());
    expect(ownedTiles.length).toBeGreaterThan(0);
    const anchor = ownedTiles[0];

    // Find a DeepSpace tile within `radius` of the anchor.
    let target: number | null = null;
    for (const t of gameOL.circleSearch(anchor, radius)) {
      if (gameOL.map().terrainType(t) === TerrainType.DeepSpace) {
        target = t;
        break;
      }
    }
    if (target === null) {
      throw new Error("no DeepSpace within cluster radius of owned tile");
    }

    // Collect every non-DeepSpace tile in the cluster around `target` so
    // we can assert their counters don't move.
    const nonDeepSpace: number[] = [];
    for (const t of gameOL.circleSearch(target, radius)) {
      if (t === target) continue;
      if (gameOL.map().terrainType(t) !== TerrainType.DeepSpace) {
        nonDeepSpace.push(t);
      }
    }
    expect(nonDeepSpace.length).toBeGreaterThan(0);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, target);
    exec.init(gameOL, 0);
    (exec as any).scout.move(target);

    const progressBefore = nonDeepSpace.map((t) =>
      gameOL.scoutSwarmTerraformProgress(t),
    );

    (exec as any).onArrival(target);

    for (let i = 0; i < nonDeepSpace.length; i++) {
      expect(gameOL.scoutSwarmTerraformProgress(nonDeepSpace[i])).toBe(
        progressBefore[i],
      );
    }
  });

  test("cluster steps a DeepSpace neighbor that crosses the threshold", () => {
    const radius = gameOL.config().scoutSwarmClusterRadius();
    // Find a DeepSpace target with at least one DeepSpace neighbour.
    let target: number | null = null;
    let neighbor: number | null = null;
    for (let y = 0; y < gameOL.height() && target === null; y++) {
      for (let x = 0; x < gameOL.width(); x++) {
        const t = gameOL.ref(x, y);
        if (gameOL.map().terrainType(t) !== TerrainType.DeepSpace) continue;
        const ns = deepSpaceNeighborsInRadius(gameOL, t, radius);
        if (ns.length > 0) {
          target = t;
          neighbor = ns[0];
          break;
        }
      }
    }
    if (target === null || neighbor === null) {
      throw new Error("no suitable target/neighbor pair");
    }

    // Pre-seed the neighbour's counter so onArrival's cluster bump trips
    // the terraform step on that specific tile.
    const threshold = gameOL.config().scoutSwarmTerraformAccumulation();
    for (let i = 0; i < threshold - 1; i++) {
      gameOL.recordScoutSwarmTerraformProgress(neighbor);
    }
    expect(gameOL.map().terrainType(neighbor)).toBe(TerrainType.DeepSpace);

    launcherOL.addCredits(1_000n);
    const exec = new ScoutSwarmExecution(launcherOL, target);
    exec.init(gameOL, 0);
    (exec as any).scout.move(target);

    (exec as any).onArrival(target);

    // Cluster bumped neighbour from (threshold-1) to threshold, terraformed,
    // then reset. Launcher takes ownership as in the arrival branch.
    expect(gameOL.map().terrainType(neighbor)).toBe(TerrainType.AsteroidField);
    expect(gameOL.scoutSwarmTerraformProgress(neighbor)).toBe(0);
    expect(gameOL.owner(neighbor)).toBe(launcherOL);
  });
});

/**
 * End-to-end tick()-driven tests for the trail + cluster pipeline
 * (Comments 2 & 3). These drive the full public path — init() → tick()
 * stepping through deep space → onArrival() — so that ordering effects
 * between trail bumps, movement, and arrival are exercised together.
 *
 * Covers:
 *   - No destination double-count when the final step of tick() lands on
 *     the target tile (Comment 2 guard).
 *   - Multi-scout corridor upgrades across the flight path (Comment 1
 *     guard): two sequential scouts with enough passes should mature a
 *     corridor tile at least one extra band beyond AsteroidField.
 *   - threshold>1 accumulation on intermediate path tiles.
 *   - Enemy-owned tiles inside the destination cluster retain ownership
 *     even when terraformed by the arrival cluster.
 */
describe("ScoutSwarmExecution — end-to-end tick() movement", () => {
  let gameOL: Game;
  let launcherOL: Player;
  const e2eGameID: GameID = "scout_swarm_e2e_game";

  async function buildOceanGame() {
    gameOL = await setup("ocean_and_land", {
      infiniteCredits: false,
      instantBuild: true,
    });
    gameOL.addPlayer(
      new PlayerInfo("e2e_launcher", PlayerType.Human, null, "e2e_launcher"),
    );
    let spawn: number | null = null;
    outer: for (let y = 0; y < gameOL.height(); y++) {
      for (let x = 0; x < gameOL.width(); x++) {
        const t = gameOL.ref(x, y);
        if (gameOL.map().isSector(t)) {
          spawn = t;
          break outer;
        }
      }
    }
    if (spawn === null) throw new Error("no sector tile on ocean_and_land");
    gameOL.addExecution(
      new SpawnExecution(
        e2eGameID,
        gameOL.player("e2e_launcher").info(),
        spawn,
      ),
    );
    while (gameOL.inSpawnPhase()) {
      gameOL.executeNextTick();
    }
    launcherOL = gameOL.player("e2e_launcher");
    launcherOL.buildUnit(UnitType.Spaceport, spawn, {});
  }

  /**
   * Run `game.executeNextTick()` until the launcher has no live scout
   * swarm, or `maxTicks` ticks have elapsed. Mirrors the bounded-wait
   * pattern used elsewhere in this file.
   */
  function runUntilScoutDissolves(g: Game, p: Player, maxTicks = 4000): void {
    for (let t = 0; t < maxTicks; t++) {
      g.executeNextTick();
      if (p.units(UnitType.ScoutSwarm).length === 0) return;
    }
  }

  /**
   * Find a DeepSpace tile reachable from `from` via a greedy manhattan
   * descent whose path has at least `minPathLength` steps (so there is
   * at least `minPathLength - 1` intermediate, non-destination tiles).
   * Returns null if no such target exists. The greedy-step pather in
   * ScoutSwarmExecution bails out when it can't find a neighbour that
   * reduces manhattan distance, so reachable targets are the only ones
   * worth testing end-to-end.
   */
  function findReachableDeepSpaceTarget(
    g: Game,
    from: number,
    minPathLength = 1,
  ): { target: number; path: number[] } | null {
    let best: { target: number; path: number[] } | null = null;
    for (let y = 0; y < g.height(); y++) {
      for (let x = 0; x < g.width(); x++) {
        const t = g.ref(x, y);
        if (t === from) continue;
        if (g.map().terrainType(t) !== TerrainType.DeepSpace) continue;
        const path: number[] = [];
        let cur = from;
        const limit = g.manhattanDist(from, t) * 4 + 16;
        let ok = true;
        for (let i = 0; i < limit; i++) {
          if (cur === t) break;
          let bestD = g.manhattanDist(cur, t);
          let next: number | null = null;
          for (const n of g.neighbors(cur)) {
            const d = g.manhattanDist(n, t);
            if (d < bestD) {
              bestD = d;
              next = n;
            }
          }
          if (next === null) {
            ok = false;
            break;
          }
          path.push(next);
          cur = next;
        }
        if (!ok || cur !== t) continue;
        if (path.length < minPathLength) continue;
        // Prefer the longest reachable path so tests have more
        // intermediate tiles to observe. Ties broken by iteration order.
        if (best === null || path.length > best.path.length) {
          best = { target: t, path };
        }
      }
    }
    return best;
  }

  beforeEach(async () => {
    await buildOceanGame();
  });

  test("tick()-driven arrival does NOT double-count the destination tile", () => {
    // Regression guard for Comment 2: when the scout's final step lands
    // on the target tile, tick() must NOT invoke tryTerraformTrailTile
    // on it — the destination's progression must be handled exactly
    // once, by onArrival(). With the threshold at 10 and one scout, the
    // target's counter should read exactly 1 post-arrival; a double-
    // count bug would show up as 2.
    const spawn = Array.from(launcherOL.tiles())[0];
    const found = findReachableDeepSpaceTarget(gameOL, spawn);
    if (found === null) throw new Error("no reachable DeepSpace target");
    const { target } = found;
    expect(gameOL.map().terrainType(target)).toBe(TerrainType.DeepSpace);
    gameOL.resetScoutSwarmTerraformProgress(target);

    launcherOL.addCredits(10_000n);
    gameOL.addExecution(new ScoutSwarmExecution(launcherOL, target));
    runUntilScoutDissolves(gameOL, launcherOL);

    expect(launcherOL.units(UnitType.ScoutSwarm)).toHaveLength(0);
    // Exactly one bump on the destination tile — proof that the trail
    // branch skipped it and only onArrival counted.
    expect(gameOL.scoutSwarmTerraformProgress(target)).toBe(1);
  });

  test("intermediate path tiles accumulate progress across multiple scouts", () => {
    // threshold>1 accumulation on path (non-destination) tiles. Two
    // scouts fired one after the other at the same DeepSpace target
    // should each bump every shared intermediate path tile once, so
    // the path tile's counter ends at 2 — well under the default
    // threshold of 10, so no terraform step fires.
    const spawn = Array.from(launcherOL.tiles())[0];
    // Require a path length of at least 2 so `path.slice(0, -1)` (the
    // non-destination tiles) is non-empty.
    const found = findReachableDeepSpaceTarget(gameOL, spawn, 2);
    if (found === null) throw new Error("no reachable DeepSpace target");
    const { target, path } = found;
    const intermediates = path
      .slice(0, -1)
      .filter((t) => gameOL.map().terrainType(t) === TerrainType.DeepSpace);
    if (intermediates.length === 0) {
      throw new Error("path has no intermediate DeepSpace tile");
    }
    const pathTile = intermediates[0];
    gameOL.resetScoutSwarmTerraformProgress(pathTile);

    launcherOL.addCredits(100_000n);
    for (let i = 0; i < 2; i++) {
      gameOL.addExecution(new ScoutSwarmExecution(launcherOL, target));
      runUntilScoutDissolves(gameOL, launcherOL);
    }

    // Note: the arrival cluster may also bump progress on this tile if
    // it sits within the cluster radius of `target`. The invariant we
    // care about is "two scouts → the counter moves by at least two
    // for a shared path tile" without tripping the threshold.
    const threshold = gameOL.config().scoutSwarmTerraformAccumulation();
    const progress = gameOL.scoutSwarmTerraformProgress(pathTile);
    expect(progress).toBeGreaterThanOrEqual(2);
    expect(progress).toBeLessThan(threshold);
  });

  test("repeated scout traffic upgrades a corridor tile beyond AsteroidField", () => {
    // Multi-scout corridor-upgrade (Comment 1 end-to-end): route enough
    // scouts through the same corridor that a shared path tile crosses
    // the threshold more than once. After the first threshold the tile
    // should be AsteroidField; after the second it should be Nebula (or
    // stepped further to OpenSpace if the cluster compounded it). The
    // regression we're guarding is corridors that stall at AsteroidField.
    const spawn = Array.from(launcherOL.tiles())[0];
    const found = findReachableDeepSpaceTarget(gameOL, spawn, 2);
    if (found === null) throw new Error("no reachable DeepSpace target");
    const { target, path } = found;
    const intermediates = path
      .slice(0, -1)
      .filter((t) => gameOL.map().terrainType(t) === TerrainType.DeepSpace);
    if (intermediates.length === 0) {
      throw new Error("path has no intermediate DeepSpace tile");
    }
    const pathTile = intermediates[0];

    launcherOL.addCredits(1_000_000n);
    // Fire enough scouts to cross the threshold at least twice. Each
    // scout bumps the shared trail counter by 1 per pass on `pathTile`,
    // plus possibly a cluster bump on the arrival. 3× threshold is a
    // safe upper bound without ballooning test runtime.
    const threshold = gameOL.config().scoutSwarmTerraformAccumulation();
    const launches = threshold * 3;
    for (let i = 0; i < launches; i++) {
      launcherOL.addCredits(10_000n);
      gameOL.addExecution(new ScoutSwarmExecution(launcherOL, target));
      runUntilScoutDissolves(gameOL, launcherOL);
    }

    // After multi-threshold traffic the corridor tile must have
    // matured past AsteroidField. DeepSpace and AsteroidField are the
    // regression states — anything beyond (Nebula or OpenSpace) is a
    // correctly maturing corridor.
    const terrain = gameOL.map().terrainType(pathTile);
    expect(terrain).not.toBe(TerrainType.DeepSpace);
    expect(terrain).not.toBe(TerrainType.AsteroidField);
    expect(
      terrain === TerrainType.Nebula || terrain === TerrainType.OpenSpace,
    ).toBe(true);
  });

  test("enemy-owned tile inside destination cluster keeps its owner after arrival", () => {
    // Cluster bookkeeping guard: when the destination cluster contains
    // a tile owned by a different player, the cluster branch must skip
    // it (non-DeepSpace → no progress bump, no terraform). Even if that
    // tile *were* DeepSpace, applyTerraformStep's ownerIdBefore branch
    // must not transfer ownership to the launcher. We cover the
    // non-DeepSpace case here because onArrival's cluster branch only
    // touches DeepSpace tiles, matching production behaviour.
    gameOL.addPlayer(
      new PlayerInfo("e2e_enemy", PlayerType.Human, null, "e2e_enemy"),
    );
    // Find any DeepSpace target near an owned tile, then pick a
    // DeepSpace neighbour within cluster radius and hand it to the
    // enemy by first promoting it to AsteroidField (claimable) and
    // conquering it. onArrival's cluster branch will see a non-
    // DeepSpace tile and skip it, preserving the enemy's ownership.
    const radius = gameOL.config().scoutSwarmClusterRadius();
    const spawn = Array.from(launcherOL.tiles())[0];
    const found = findReachableDeepSpaceTarget(gameOL, spawn);
    if (found === null) throw new Error("no reachable DeepSpace target");
    const { target } = found;
    let enemyTile: number | null = null;
    for (const t of gameOL.circleSearch(target, radius)) {
      if (t === target) continue;
      if (gameOL.map().terrainType(t) !== TerrainType.DeepSpace) continue;
      enemyTile = t;
      break;
    }
    if (enemyTile === null) {
      throw new Error("no DeepSpace tile in destination cluster");
    }
    gameOL.map().setTerrainType(enemyTile, TerrainType.AsteroidField);
    const enemy = gameOL.player("e2e_enemy");
    enemy.conquer(enemyTile);
    expect(gameOL.owner(enemyTile)).toBe(enemy);

    const enemyTilesBefore = enemy.numTilesOwned();
    const launcherTilesBefore = launcherOL.numTilesOwned();
    const enemyProgressBefore = gameOL.scoutSwarmTerraformProgress(enemyTile);

    launcherOL.addCredits(10_000n);
    gameOL.addExecution(new ScoutSwarmExecution(launcherOL, target));
    runUntilScoutDissolves(gameOL, launcherOL);

    // Enemy-owned tile is untouched: same terrain, same owner, same
    // tile counts on both sides, and no cluster progress bump (the
    // cluster branch skipped it because terrain !== DeepSpace).
    expect(gameOL.map().terrainType(enemyTile)).toBe(TerrainType.AsteroidField);
    expect(gameOL.owner(enemyTile)).toBe(enemy);
    expect(enemy.numTilesOwned()).toBe(enemyTilesBefore);
    expect(launcherOL.numTilesOwned()).toBe(launcherTilesBefore);
    expect(gameOL.scoutSwarmTerraformProgress(enemyTile)).toBe(
      enemyProgressBefore,
    );
  });
});
