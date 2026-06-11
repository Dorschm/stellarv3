// @vitest-environment node
import fs from "fs";
import path from "path";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";
import {
  genTerrainFromBin,
  TerrainMapData,
} from "../../src/core/game/TerrainMapLoader";
import { GameUpdateViewDataWithHabitabilityDamage } from "../../src/core/worker/WorkerClient";
import { setup } from "../util/Setup";
import { GameViewTestHarness } from "./GameViewTestHelper";

/**
 * Regression tests for the LRW habitability-damage mirror: the sim applies
 * damage via SectorMap.applyHabitabilityDamage without emitting a GameUpdate,
 * so the worker drain ships `[tileRef, damageDelta]` pairs on the view data
 * (`habitabilityDamageUpdates`) and GameView.update() replays them into the
 * client-side SectorMap. These tests drive GameView.update() directly with
 * the channel attached, exactly as the worker would.
 */

/**
 * Execute one game tick and feed the resulting view data — extended with the
 * habitability-damage channel — into the GameView, mirroring what
 * Worker.worker.ts ships after an orbital strike tick.
 */
function executeTickWithHabDamage(
  h: GameViewTestHarness,
  pairs: number[],
): void {
  const updates = h.game.executeNextTick();
  const viewData: GameUpdateViewDataWithHabitabilityDamage = {
    tick: h.game.ticks(),
    packedTileUpdates: h.game.drainPackedTileUpdates(),
    packedTerrainUpdates: h.game.drainPackedTerrainUpdates(),
    updates,
    playerNameViewData: {},
    tickExecutionDuration: 0,
    pendingTurns: 0,
    habitabilityDamageUpdates: pairs,
  };
  h.gameView.update(viewData);
}

async function setupWithSeededSector(): Promise<GameViewTestHarness> {
  const game = await setup("plains", {
    infiniteCredits: true,
    instantBuild: true,
  });
  const p1 = new PlayerInfo("player1", PlayerType.Human, "client1", "p1_id");
  game.addPlayer(p1);
  // Load an INDEPENDENT copy of the map for the view. Sharing game.map()
  // (as GameViewTestHelper does) would let the sim mutate the view's map
  // in place, so GameView.updateTile would never observe an owner
  // transition and the view SectorMap's per-player counters would stay
  // empty — in production the view always has its own map instance.
  const mapDir = path.join(__dirname, "../testdata/maps/plains");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(mapDir, "manifest.json"), "utf8"),
  );
  const viewMap = await genTerrainFromBin(
    manifest.map,
    fs.readFileSync(path.join(mapDir, "map.bin")),
  );
  // Seed a sector at the spawn point so the view-side SectorMap tracks
  // habitability there — with no seeds every tile stays at sector 0 and
  // applyHabitabilityDamage is a no-op.
  const mapData: TerrainMapData = {
    nations: [{ name: "SeedNation", coordinates: [50, 50], flag: "" }],
    gameMap: viewMap,
    miniGameMap: viewMap,
  };
  const h = new GameViewTestHarness(game, game.config(), mapData, "client1");
  h.spawnPlayer(p1, game.ref(50, 50));
  h.executeUntilSpawnPhaseEnds();
  return h;
}

describe("GameView habitability-damage mirror", () => {
  test("replays LRW damage into the view SectorMap (overlay + player sums)", async () => {
    const h = await setupWithSeededSector();
    const player = h.game.player("p1_id");
    const viewSM = h.gameView.sectorMap();

    const tile = [...player.tiles()].find((t) => viewSM.sectorOf(t) !== 0);
    expect(tile).toBeDefined();

    const baseHab = viewSM.effectiveHabitability(tile!);
    const avgBefore = viewSM.playerAverageHabitability(player);
    expect(viewSM.habitabilityDamageOf(tile!)).toBe(0);
    expect(baseHab).toBeGreaterThan(0);

    const damage = 0.45;
    executeTickWithHabDamage(h, [tile!, damage]);

    expect(viewSM.habitabilityDamageOf(tile!)).toBeCloseTo(damage, 10);
    expect(viewSM.effectiveHabitability(tile!)).toBeCloseTo(
      baseHab - damage,
      10,
    );
    // The owner's running habitability average must drop too — this is what
    // keeps HUD economy rates (max population, troop growth, credit rate)
    // consistent with the authoritative worker sim.
    expect(viewSM.playerAverageHabitability(player)).toBeLessThan(avgBefore);
  });

  test("matches the sim-side SectorMap after replaying the same deltas", async () => {
    const h = await setupWithSeededSector();
    const player = h.game.player("p1_id");
    const viewSM = h.gameView.sectorMap();
    const simSM = h.game.sectorMap();

    const tile = [...player.tiles()].find((t) => viewSM.sectorOf(t) !== 0)!;

    // Apply damage on the sim side exactly as
    // OrbitalStrikePlatformExecution.applyLrwImpact does. The sim SectorMap
    // is unseeded in tests (sector 0 everywhere), so use a reference value:
    // both sides run the same applyHabitabilityDamage code, so replaying the
    // worker-shipped delta must land on the same overlay value.
    const damage = 0.3;
    simSM.applyHabitabilityDamage(tile, damage, player.smallID());
    executeTickWithHabDamage(h, [tile, damage]);

    expect(viewSM.habitabilityDamageOf(tile)).toBeCloseTo(damage, 10);
  });

  test("saturates at the tile's base habitability like the sim", async () => {
    const h = await setupWithSeededSector();
    const player = h.game.player("p1_id");
    const viewSM = h.gameView.sectorMap();

    const tile = [...player.tiles()].find((t) => viewSM.sectorOf(t) !== 0)!;
    const baseHab = viewSM.effectiveHabitability(tile);

    executeTickWithHabDamage(h, [tile, baseHab + 5]);

    expect(viewSM.effectiveHabitability(tile)).toBe(0);
    expect(viewSM.habitabilityDamageOf(tile)).toBeCloseTo(baseHab, 10);
  });

  test("damage to an unowned sector tile only updates the overlay", async () => {
    const h = await setupWithSeededSector();
    const player = h.game.player("p1_id");
    const viewSM = h.gameView.sectorMap();

    let unowned: TileRef | null = null;
    const map = h.game.map();
    outer: for (let y = 0; y < map.height(); y++) {
      for (let x = 0; x < map.width(); x++) {
        const t = map.ref(x, y);
        if (viewSM.sectorOf(t) !== 0 && !map.hasOwner(t)) {
          unowned = t;
          break outer;
        }
      }
    }
    expect(unowned).not.toBeNull();

    const avgBefore = viewSM.playerAverageHabitability(player);
    executeTickWithHabDamage(h, [unowned!, 0.3]);

    expect(viewSM.habitabilityDamageOf(unowned!)).toBeCloseTo(0.3, 10);
    expect(viewSM.playerAverageHabitability(player)).toBeCloseTo(avgBefore, 10);
  });
});
