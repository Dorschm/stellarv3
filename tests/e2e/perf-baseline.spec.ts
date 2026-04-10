import { test } from "@playwright/test";
import {
  startSingleplayerGame,
  waitForTicksAbove,
} from "./fixtures/game-fixtures";

/**
 * One-shot perf baseline capture.
 *
 * Boots a singleplayer game, turns on the perf instrumentation via the
 * `__perfStart` window global, plays for a fixed number of ticks, then
 * captures and logs the merged (renderer + worker) snapshot.
 *
 * This spec is not part of the regular E2E suite — it is meant to be run
 * manually (`npx playwright test tests/e2e/perf-baseline.spec.ts`) before
 * and after optimization work to see which systems dominate each frame /
 * tick.
 */

interface PerfSample {
  name: string;
  avg: number;
  max: number;
  calls: number;
}

test.setTimeout(600_000);

test("capture perf baseline", async ({ page }) => {
  await startSingleplayerGame(page);

  // Let the player establish some territory before we start measuring so
  // the snapshot is representative of mid-game workload rather than the
  // empty-map opening. Headless chromium throttles timers so tick rate is
  // well under the 10 tps real-time target.
  const warmupTarget = await page.evaluate(() => {
    const w = window as unknown as { __gameView: { ticks(): number } };
    return w.__gameView.ticks() + 80;
  });
  await waitForTicksAbove(page, warmupTarget, 180_000);

  // Enable perf instrumentation in both the renderer and the worker.
  await page.evaluate(() => {
    const w = window as unknown as { __perfStart: () => void };
    w.__perfStart();
  });

  // Run for 200 ticks of measurement — enough to average out spikes but
  // achievable within the headless timer throttling budget.
  const measureStart = await page.evaluate(() => {
    const w = window as unknown as { __gameView: { ticks(): number } };
    return w.__gameView.ticks();
  });
  await waitForTicksAbove(page, measureStart + 200, 240_000);

  // Give the worker-side snapshot interval one more tick to deliver its
  // most-recent batch before we read it from the main thread.
  await page.waitForTimeout(1200);

  const samples = (await page.evaluate(() => {
    const w = window as unknown as { __perfSnapshot: () => PerfSample[] };
    return w.__perfSnapshot();
  })) as PerfSample[];

  await page.evaluate(() => {
    const w = window as unknown as { __perfStop: () => void };
    w.__perfStop();
  });

  // Format as a plain table so the log output is easy to compare
  // between baseline / post-fix runs.
  const header =
    "name                                       avg      max      calls";
  const rows = samples.map((s) => {
    const name = s.name.padEnd(42).slice(0, 42);
    const avg = s.avg.toFixed(3).padStart(8);
    const max = s.max.toFixed(3).padStart(8);
    const calls = String(s.calls).padStart(10);
    return `${name} ${avg} ${max} ${calls}`;
  });
  console.log(
    `\n=== PERF BASELINE (${samples.length} counters) ===\n` +
      header +
      "\n" +
      rows.join("\n") +
      "\n=== END PERF BASELINE ===\n",
  );
});
