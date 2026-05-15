import { dirname } from "path";
import { fileURLToPath } from "url";
import { MirvExecution } from "../../src/core/execution/ClusterWarheadExecution";
import { NukeExecution } from "../../src/core/execution/NukeExecution";
import {
  Execution,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

// GameImpl exposes `executions()` but the public Game interface doesn't.
// We need it here to detect submunition NukeExecutions still alive in
// `unInitExecs` between MRV separation and the tick that spawns their
// units — without this we'd terminate the measurement window prematurely
// (both unit counts hit 0 in that gap).
interface GameWithExecutions extends Game {
  executions(): Execution[];
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

type Fixture = { game: Game; player: Player };

async function buildSparseTerritoryFixture(): Promise<Fixture> {
  const game = await setup(
    "big_plains",
    { infiniteCredits: true, instantBuild: true },
    [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
    moduleDir,
  );

  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }

  const player = game.player("player_id");

  const claimRow = (y: number, length: number) => {
    for (let x = 0; x < 200; x++) {
      for (let dy = y; dy < y + length; dy++) {
        const tile = game.ref(x, dy);
        if (game.map().isSector(tile)) {
          player.conquer(tile);
        }
      }
    }
  };

  claimRow(0, 15);
  claimRow(40, 15);
  claimRow(90, 15);
  claimRow(140, 15);
  claimRow(185, 15);

  player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(10, 10), {});
  return { game, player };
}

async function buildDenseTerritoryFixture(): Promise<Fixture> {
  const game = await setup(
    "big_plains",
    { infiniteCredits: true, instantBuild: true },
    [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
    moduleDir,
  );

  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }

  const player = game.player("player_id");

  for (let x = 0; x < 200; x++) {
    for (let y = 0; y < 200; y++) {
      const tile = game.ref(x, y);
      if (game.map().isSector(tile)) {
        player.conquer(tile);
      }
    }
  }

  player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(10, 10), {});
  return { game, player };
}

async function buildGiantMapFixture(): Promise<Fixture> {
  const game = await setup(
    "giantworldmap",
    { infiniteCredits: true, instantBuild: true },
    [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
    moduleDir,
  );

  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }

  const player = game.player("player_id");

  let conqueredCount = 0;
  for (let x = 0; x < game.map().width(); x++) {
    for (let y = 0; y < game.map().height(); y++) {
      const tile = game.ref(x, y);
      if (game.map().isSector(tile)) {
        player.conquer(tile);
        conqueredCount++;
      }
    }
  }
  console.log(`Conquered ${conqueredCount} tiles on giant world map`);

  player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(800, 350), {});
  return { game, player };
}

/**
 * Worst-tick budget across the MRV submunition lifecycle — i.e. every
 * tick from the first submunition spawn through the final detonation.
 * The player-visible freeze ticket reported "freezes when an MRV lands";
 * that's the submunition flight + detonation cluster, which is what
 * this budget guards.
 *
 * Pre-separation ticks (warhead climb to separation point, and the
 * `selectDestinations` cost in `MirvExecution.separate()` itself) are
 * tracked in the per-tick profile but are NOT asserted against this
 * budget — they are part of the parent `MirvExecution`, not the
 * submunition lifecycle, and they're already covered by
 * `ClusterWarheadPerf.ts` (which measures `MirvExecution.tick` in
 * isolation). The sparse/dense fixtures exhibit a one-tick separation
 * spike on the order of 35–75ms in `selectDestinations` when the
 * target's owner has scattered territory; that's a separate concern
 * tracked separately.
 *
 * 25ms covers the steady-state mid-flight cost on the slowest CI
 * runner after Cut #1 (`getTrajectory` skip) and Cut #2 (bounded
 * `nearbyUnits` detonate scans). Tune up only if a slower runner trips
 * it without an actual regression.
 */
const FULL_SIM_WORST_TICK_BUDGET_MS = 25;

/**
 * Pre-change worst-tick baselines for the submunition lifecycle window,
 * captured BEFORE Cut #1 (`getTrajectory` skip) and Cut #2 (bounded
 * `nearbyUnits` detonate scans). The ticket's ≥50% worst-tick reduction
 * acceptance criterion applies to these scenarios — the current
 * lifecycle worst-tick must be at most `RATIO_VS_BASELINE` × baseline.
 *
 * The absolute budget above acts as a supplemental upper bound. Without
 * a ratio check, a regression that doubled the per-tick cost while
 * staying under 25ms would silently pass.
 *
 * If a future product change moves the lifecycle cost legitimately
 * (e.g. submunition count or trajectory representation changes),
 * update both the baseline and the absolute budget in the same diff.
 */
const FULL_SIM_PRE_CHANGE_LIFECYCLE_BASELINES: Record<
  "sparse" | "dense" | "giant",
  number
> = {
  sparse: 70,
  dense: 90,
  giant: 200,
};

/** Lifecycle worst tick must be at most this fraction of the baseline. */
const FULL_SIM_REQUIRED_RATIO_VS_BASELINE = 0.5;

/** Safety cap so a non-terminating execution can't hang the perf run. */
const MAX_TICKS = 4000;

type TickSample = {
  tick: number;
  ms: number;
  inFlightSubmunitions: number;
  /** True for ticks belonging to the submunition lifecycle window:
   *  from the first tick a submunition exists (or its pending NukeExec
   *  is queued) through the last tick before everything resolves.
   *  Excludes the pre-separation warhead climb. */
  inLifecycle: boolean;
};

type Report = {
  /** Worst tick across the *whole* harness window — for reporting. */
  worstMsAny: number;
  worstTickAny: number;
  /** Worst tick restricted to the submunition lifecycle window — the
   *  number the budget asserts on. */
  worstMsLifecycle: number;
  worstTickLifecycle: number;
  meanMs: number;
  totalTicks: number;
  samples: TickSample[];
};

/**
 * Runs an MRV launch end-to-end (launch → mid-flight → separation →
 * submunition dispersal → final detonation) and returns the worst tick
 * observed across the full window. The fixture is mutated; build a fresh
 * one per measurement so accumulated units/executions can't bias the
 * sample.
 */
type ExecCheck = {
  /** Is the parent MirvExecution still alive (pre-separation)? */
  mrvAlive: boolean;
  /** Is any submunition NukeExecution still active or pending? */
  submunitionExecActive: boolean;
};

function measureFullSimulation(
  game: Game,
  player: Player,
  targetTile: number,
): Report {
  const gameImpl = game as GameWithExecutions;
  game.addExecution(new MirvExecution(player, targetTile));

  const samples: TickSample[] = [];
  let worstMsAny = 0;
  let worstTickAny = 0;
  let worstMsLifecycle = 0;
  let worstTickLifecycle = 0;
  let totalMs = 0;
  let launched = false;

  const inspectExecs = (): ExecCheck => {
    let mrvAlive = false;
    let submunitionExecActive = false;
    for (const exec of gameImpl.executions()) {
      if (!exec.isActive()) continue;
      if (exec instanceof MirvExecution) {
        mrvAlive = true;
      } else if (exec instanceof NukeExecution && exec.owner() === player) {
        // The fixture never queues non-MRV nukes, so any NukeExecution
        // owned by this player belongs to the submunition cluster.
        // `getNuke()` returns null until the unit is built; treating
        // null as "still pending" catches the unInitExecs queue gap.
        const nuke = exec.getNuke();
        if (
          nuke === null ||
          nuke.type() === UnitType.ClusterWarheadSubmunition
        ) {
          submunitionExecActive = true;
        }
      }
    }
    return { mrvAlive, submunitionExecActive };
  };

  for (let t = 0; t < MAX_TICKS; t++) {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    game.executeNextTick();
    const t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = t1 - t0;

    const inFlightSubmunitions = player.units(
      UnitType.ClusterWarheadSubmunition,
    ).length;
    const warheadCount = player.units(UnitType.ClusterWarhead).length;
    const { mrvAlive, submunitionExecActive } = inspectExecs();

    if (
      warheadCount > 0 ||
      inFlightSubmunitions > 0 ||
      mrvAlive ||
      submunitionExecActive
    ) {
      launched = true;
    }

    // A tick belongs to the submunition lifecycle if a submunition is
    // already in the air OR a submunition NukeExecution is queued/active.
    // The MRV's parent execution and its pre-separation warhead climb
    // are intentionally excluded — those are part of `MirvExecution`
    // itself and are covered by `ClusterWarheadPerf.ts`.
    const inLifecycle = inFlightSubmunitions > 0 || submunitionExecActive;

    samples.push({ tick: t, ms: dt, inFlightSubmunitions, inLifecycle });
    totalMs += dt;
    if (dt > worstMsAny) {
      worstMsAny = dt;
      worstTickAny = t;
    }
    if (inLifecycle && dt > worstMsLifecycle) {
      worstMsLifecycle = dt;
      worstTickLifecycle = t;
    }

    if (
      launched &&
      warheadCount === 0 &&
      inFlightSubmunitions === 0 &&
      !mrvAlive &&
      !submunitionExecActive
    ) {
      break;
    }
  }

  return {
    worstMsAny,
    worstTickAny,
    worstMsLifecycle,
    worstTickLifecycle,
    meanMs: samples.length > 0 ? totalMs / samples.length : 0,
    totalTicks: samples.length,
    samples,
  };
}

function summarizeSamples(samples: TickSample[]): string {
  // Show every tick that's either expensive (>=2ms) or in the submunition
  // lifecycle, plus the top-10 slowest. That gives us the flight window
  // (so we can see steady-state submunition cost) and the spikes (so we
  // can see the spawn/detonate clusters) without dumping every idle tick.
  const interesting = samples.filter(
    (s) => s.ms >= 2 || s.inLifecycle || s.inFlightSubmunitions > 0,
  );
  const top10 = [...samples].sort((a, b) => b.ms - a.ms).slice(0, 10);

  const seen = new Set<number>();
  const merged: TickSample[] = [];
  for (const s of [...interesting, ...top10]) {
    if (seen.has(s.tick)) continue;
    seen.add(s.tick);
    merged.push(s);
  }
  merged.sort((a, b) => a.tick - b.tick);

  if (merged.length === 0) {
    return "    (no interesting ticks)";
  }

  // Cap the list so a multi-hundred-tick flight doesn't flood the
  // console. Keep the first 30 and last 30 ticks of the merged set —
  // the spawn cluster and the detonation cluster.
  const MAX_LINES = 60;
  let display = merged;
  let ellipsisAt = -1;
  if (merged.length > MAX_LINES) {
    const head = merged.slice(0, MAX_LINES / 2);
    const tail = merged.slice(merged.length - MAX_LINES / 2);
    display = [...head, ...tail];
    ellipsisAt = head.length;
  }

  return display
    .map(
      (s, idx) =>
        (idx === ellipsisAt ? "    ...\n" : "") +
        `    tick=${s.tick.toString().padStart(4)} ` +
        `ms=${s.ms.toFixed(2).padStart(7)} ` +
        `subs=${s.inFlightSubmunitions.toString().padStart(3)} ` +
        `${s.inLifecycle ? "L" : " "}`,
    )
    .join("\n");
}

const scenarios: {
  name: "sparse" | "dense" | "giant";
  build: () => Promise<Fixture>;
  target: (g: Game) => number;
}[] = [
  {
    name: "sparse",
    build: buildSparseTerritoryFixture,
    target: (g) => g.ref(100, 100),
  },
  {
    name: "dense",
    build: buildDenseTerritoryFixture,
    target: (g) => g.ref(100, 100),
  },
  {
    name: "giant",
    build: buildGiantMapFixture,
    target: (g) => g.ref(2150, 800),
  },
];

/**
 * Independent measurement iterations per scenario. Each iteration
 * rebuilds the fixture so that prior-run mutations (in-flight units,
 * accumulated executions, advanced tick counts) can't bias the next
 * worst-tick sample. We keep this small because the giant-map fixture
 * costs several seconds to build (full-map conquer over a multi-million
 * tile grid).
 */
const ITER_COUNT = 3;

type ScenarioResult = {
  /** Best (smallest) per-iteration worst-lifecycle-tick. Closest
   *  estimate of the actual code cost, with noise filtered out. */
  bestLifecycleMs: number;
  worstLifecycleMs: number;
  lifecycleByIter: { ms: number; tick: number }[];
  /** Best/worst across the entire harness window — pre-separation cost
   *  included, reported for visibility but not asserted. */
  bestAnyMs: number;
  worstAnyMs: number;
  anyByIter: { ms: number; tick: number }[];
  meanMs: number;
  representativeReport: Report;
};

const results: Record<string, ScenarioResult> = {};

for (const scenario of scenarios) {
  console.log(`\n=== Scenario: ${scenario.name} ===`);
  const iterReports: Report[] = [];
  for (let iter = 0; iter < ITER_COUNT; iter++) {
    console.log(`  Iteration ${iter + 1}/${ITER_COUNT}: building fixture...`);
    const fixture = await scenario.build();
    console.log(`  Iteration ${iter + 1}/${ITER_COUNT}: running...`);
    const report = measureFullSimulation(
      fixture.game,
      fixture.player,
      scenario.target(fixture.game),
    );
    iterReports.push(report);
    console.log(
      `    totalTicks=${report.totalTicks} ` +
        `worstAny=${report.worstMsAny.toFixed(2)}ms@${report.worstTickAny} ` +
        `worstLifecycle=${report.worstMsLifecycle.toFixed(2)}ms@${report.worstTickLifecycle} ` +
        `mean=${report.meanMs.toFixed(2)}ms`,
    );
  }

  const lifecycleByIter = iterReports.map((r) => r.worstMsLifecycle);
  const anyByIter = iterReports.map((r) => r.worstMsAny);
  const meanAcross =
    iterReports.reduce((a, r) => a + r.meanMs, 0) / iterReports.length;
  // Representative profile: iteration with the lowest *lifecycle* worst
  // tick — cleanest signal of submunition-window cost.
  const representative = iterReports.reduce((acc, r) =>
    r.worstMsLifecycle < acc.worstMsLifecycle ? r : acc,
  );

  results[scenario.name] = {
    bestLifecycleMs: Math.min(...lifecycleByIter),
    worstLifecycleMs: Math.max(...lifecycleByIter),
    lifecycleByIter: iterReports.map((r) => ({
      ms: r.worstMsLifecycle,
      tick: r.worstTickLifecycle,
    })),
    bestAnyMs: Math.min(...anyByIter),
    worstAnyMs: Math.max(...anyByIter),
    anyByIter: iterReports.map((r) => ({
      ms: r.worstMsAny,
      tick: r.worstTickAny,
    })),
    meanMs: meanAcross,
    representativeReport: representative,
  };

  console.log(`  Per-tick profile (least-noisy lifecycle iteration):`);
  console.log(summarizeSamples(representative.samples));
}

console.log("\n=== MRV Full-Simulation Perf Summary ===");
console.log(
  "  (lifecycle = submunition window only; any = whole sim incl. separation)",
);
for (const scenario of scenarios) {
  const r = results[scenario.name];
  const lifecyclePerIter = r.lifecycleByIter
    .map((w) => `${w.ms.toFixed(1)}ms@${w.tick}`)
    .join(", ");
  const anyPerIter = r.anyByIter
    .map((w) => `${w.ms.toFixed(1)}ms@${w.tick}`)
    .join(", ");
  console.log(
    `${scenario.name.padEnd(7)} lifecycle ` +
      `best=${r.bestLifecycleMs.toFixed(2)}ms ` +
      `max=${r.worstLifecycleMs.toFixed(2)}ms ` +
      `[${lifecyclePerIter}]`,
  );
  console.log(
    `${"".padEnd(7)} any       ` +
      `best=${r.bestAnyMs.toFixed(2)}ms ` +
      `max=${r.worstAnyMs.toFixed(2)}ms ` +
      `[${anyPerIter}]`,
  );
}

console.log(
  `\nWorst-tick budget: ${FULL_SIM_WORST_TICK_BUDGET_MS}ms across the entire submunition lifecycle.`,
);

// Budget is asserted against the *lifecycle* best-of-N. A reproducible
// freeze in the submunition window would exceed the budget on every
// iteration (so the minimum still trips); a one-off GC pause inflates
// `worstLifecycleMs` only, which we report but don't assert on. The
// pre-separation `selectDestinations` cost is intentionally out of
// scope here — it's a property of the parent MRV warhead, not the
// submunition lifecycle this ticket targets.
const offenders = scenarios
  .map((s) => ({ name: s.name, worst: results[s.name].bestLifecycleMs }))
  .filter((o) => o.worst > FULL_SIM_WORST_TICK_BUDGET_MS);

if (offenders.length > 0) {
  const detail = offenders
    .map((o) => `${o.name}=${o.worst.toFixed(2)}ms`)
    .join(", ");
  throw new Error(
    `MRV submunition-lifecycle worst-tick budget regression. ` +
      `Budget ${FULL_SIM_WORST_TICK_BUDGET_MS}ms (best of ${ITER_COUNT}). ` +
      `Offenders: ${detail}. ` +
      `Inspect the per-tick profile above to localize the freeze window.`,
  );
}

// Load-bearing ratio assertion (ticket acceptance criterion): current
// lifecycle worst-tick must be at most 50% of the pinned pre-change
// baseline per scenario. We use the best-of-N (the least-noisy
// iteration) on both sides — that's the same statistic the absolute
// budget asserts, applied as a ratio so a regression that doubles the
// per-tick cost while staying under the absolute budget still fails.
const ratioOffenders = (["sparse", "dense", "giant"] as const).flatMap(
  (name) => {
    const current = results[name].bestLifecycleMs;
    const baseline = FULL_SIM_PRE_CHANGE_LIFECYCLE_BASELINES[name];
    const cap = baseline * FULL_SIM_REQUIRED_RATIO_VS_BASELINE;
    return current > cap ? [{ name, current, baseline, cap }] : [];
  },
);

console.log(
  `\nLifecycle worst-tick ratio check (current ≤ ${(
    FULL_SIM_REQUIRED_RATIO_VS_BASELINE * 100
  ).toFixed(0)}% of pre-change baseline):`,
);
for (const name of ["sparse", "dense", "giant"] as const) {
  const current = results[name].bestLifecycleMs;
  const baseline = FULL_SIM_PRE_CHANGE_LIFECYCLE_BASELINES[name];
  const cap = baseline * FULL_SIM_REQUIRED_RATIO_VS_BASELINE;
  const pct = (current / baseline) * 100;
  console.log(
    `  ${name}: ${current.toFixed(2)}ms vs baseline ${baseline.toFixed(2)}ms ` +
      `(${pct.toFixed(1)}%, cap ${cap.toFixed(2)}ms)`,
  );
}

if (ratioOffenders.length > 0) {
  const detail = ratioOffenders
    .map((o) => {
      const pct = (o.current / o.baseline) * 100;
      return `${o.name}=${o.current.toFixed(2)}ms (${pct.toFixed(
        1,
      )}% of ${o.baseline.toFixed(2)}ms baseline)`;
    })
    .join(", ");
  throw new Error(
    `MRV submunition-lifecycle ≥50% reduction regression — current ` +
      `lifecycle worst-tick must be at most ` +
      `${(FULL_SIM_REQUIRED_RATIO_VS_BASELINE * 100).toFixed(0)}% of the ` +
      `pre-change baseline. Offenders: ${detail}.`,
  );
}
