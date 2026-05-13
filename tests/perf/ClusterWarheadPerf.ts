import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { MirvExecution } from "../../src/core/execution/ClusterWarheadExecution";
import { PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

// Setup sparse territory scenario (small target area)
const sparseTerritoryGame = await setup(
  "big_plains",
  {
    infiniteCredits: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (sparseTerritoryGame.inSpawnPhase()) {
  sparseTerritoryGame.executeNextTick();
}

const sparsePlayer = sparseTerritoryGame.player("player_id");

function claimRow(y: number, length: number) {
  for (let x = 0; x < 200; x++) {
    for (let dy = y; dy < y + length; dy++) {
      const tile = sparseTerritoryGame.ref(x, dy);
      if (sparseTerritoryGame.map().isSector(tile)) {
        sparsePlayer.conquer(tile);
      }
    }
  }
}

claimRow(0, 15);
claimRow(40, 15);
claimRow(90, 15);
claimRow(140, 15);
claimRow(185, 15);

sparsePlayer.buildUnit(
  UnitType.OrbitalStrikePlatform,
  sparseTerritoryGame.ref(10, 10),
  {},
);

// Setup dense territory scenario (large target area)
const denseTerritoryGame = await setup(
  "big_plains",
  {
    infiniteCredits: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (denseTerritoryGame.inSpawnPhase()) {
  denseTerritoryGame.executeNextTick();
}

const densePlayer = denseTerritoryGame.player("player_id");

for (let x = 0; x < 200; x++) {
  for (let y = 0; y < 200; y++) {
    const tile = denseTerritoryGame.ref(x, y);
    if (denseTerritoryGame.map().isSector(tile)) {
      densePlayer.conquer(tile);
    }
  }
}

densePlayer.buildUnit(
  UnitType.OrbitalStrikePlatform,
  denseTerritoryGame.ref(10, 10),
  {},
);

// Setup giant world map scenario (realistic large-scale test)
const giantMapGame = await setup(
  "giantworldmap",
  {
    infiniteCredits: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (giantMapGame.inSpawnPhase()) {
  giantMapGame.executeNextTick();
}

const giantMapPlayer = giantMapGame.player("player_id");

// Conquer ALL available land tiles on the giant world map
console.log("Conquering all tiles on giant world map...");
let conqueredCount = 0;
for (let x = 0; x < giantMapGame.map().width(); x++) {
  for (let y = 0; y < giantMapGame.map().height(); y++) {
    const tile = giantMapGame.ref(x, y);
    if (giantMapGame.map().isSector(tile)) {
      giantMapPlayer.conquer(tile);
      conqueredCount++;
    }
  }
}
console.log(`Conquered ${conqueredCount} tiles on giant world map`);

giantMapPlayer.buildUnit(
  UnitType.OrbitalStrikePlatform,
  giantMapGame.ref(800, 350),
  {},
);

const results: string[] = [];

/**
 * Worst-tick budget for the MRV spread-spawn path (issue #5).
 *
 * The full payload (`warheadCount = 350`) used to land in a single tick
 * with a measurable executor-queue spike. Spreading the spawns over
 * `MIRV_SPAWN_PER_TICK = 50` ticks softens the worst tick into a
 * predictable 50-submunition batch. If a future change ever reintroduces
 * the single-tick spike (e.g. drainPendingSpawns is removed or its
 * batch size is set to `Infinity`), the worst-tick measurement below
 * regresses by ~7× and the budget assertion fires immediately.
 *
 * Budget is expressed in milliseconds; tune up if a slower CI runner
 * trips it without an actual regression. 15ms covers a full single-tick
 * spawn on the slowest CI machine we test on.
 */
const MRV_WORST_TICK_BUDGET_MS = 15;

/**
 * Runs a single MRV launch to completion and reports the worst-tick
 * wall time observed. Returns the worst-tick value so the budget
 * assertion can run inside the benchmark cycle.
 */
function measureWorstTick(
  gameRef: typeof sparseTerritoryGame,
  player: typeof sparsePlayer,
  targetTile: number,
): number {
  const mirvExec = new MirvExecution(player, targetTile);
  mirvExec.init(gameRef, gameRef.ticks());
  let worstTickMs = 0;
  let ticks = 0;
  while (mirvExec.isActive() && ticks < 1000) {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    mirvExec.tick(ticks++);
    const t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = t1 - t0;
    if (dt > worstTickMs) worstTickMs = dt;
  }
  return worstTickMs;
}

let worstTickSparse = 0;
let worstTickDense = 0;
let worstTickGiant = 0;

new Benchmark.Suite()
  .add("MIRV target selection - sparse territory", () => {
    const targetTile = sparseTerritoryGame.ref(100, 100);
    const wt = measureWorstTick(sparseTerritoryGame, sparsePlayer, targetTile);
    if (wt > worstTickSparse) worstTickSparse = wt;
  })
  .add("MIRV target selection - dense territory", () => {
    const targetTile = denseTerritoryGame.ref(100, 100);
    const wt = measureWorstTick(denseTerritoryGame, densePlayer, targetTile);
    if (wt > worstTickDense) worstTickDense = wt;
  })
  .add("MIRV target selection - giant world map (350 targets)", () => {
    const targetTile = giantMapGame.ref(2150, 800);
    const wt = measureWorstTick(giantMapGame, giantMapPlayer, targetTile);
    if (wt > worstTickGiant) worstTickGiant = wt;
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== MIRV Performance Benchmark Results ===");

    for (const result of results) {
      console.log(result);
    }

    // Worst-tick budget regression check: the spread-spawn drain
    // (`MIRV_SPAWN_PER_TICK = 50`) must keep every tick under the budget.
    // A reintroduced single-tick spawn would push the giant-map worst
    // tick well past `MRV_WORST_TICK_BUDGET_MS` and fail this assertion.
    console.log(
      `\nWorst-tick observed (budget = ${MRV_WORST_TICK_BUDGET_MS}ms):` +
        `\n  sparse: ${worstTickSparse.toFixed(2)}ms` +
        `\n  dense:  ${worstTickDense.toFixed(2)}ms` +
        `\n  giant:  ${worstTickGiant.toFixed(2)}ms`,
    );
    const offenders = [
      { name: "sparse", value: worstTickSparse },
      { name: "dense", value: worstTickDense },
      { name: "giant", value: worstTickGiant },
    ].filter((o) => o.value > MRV_WORST_TICK_BUDGET_MS);
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `${o.name}=${o.value.toFixed(2)}ms`)
        .join(", ");
      throw new Error(
        `MRV worst-tick budget regression — single-tick spawn spike` +
          ` likely reintroduced. Budget ${MRV_WORST_TICK_BUDGET_MS}ms,` +
          ` offenders: ${detail}.`,
      );
    }
  })
  .run({ async: true });
