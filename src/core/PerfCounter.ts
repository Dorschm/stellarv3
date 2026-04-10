/**
 * Lightweight rolling-average performance counter shared between the
 * client renderer (per-frame work) and the simulation tick loop
 * (per-execution work).
 *
 * Counters live in a module-scoped registry keyed by name. Instrumentation
 * call-sites use the {@link perfBegin} / {@link perfEnd} pair (or
 * {@link perfMeasure} for one-shot wrapping). When disabled, the
 * instrumentation degrades to a single boolean check + branch — no
 * `performance.now()` call, no allocation — so it is safe to leave compiled
 * into production builds.
 *
 * The PerformanceOverlay HUD turns instrumentation on while it is visible
 * via {@link perfEnable}, polls {@link perfSnapshot} once per second to
 * render a sorted top-N list, and clears the registry on reset.
 */

const SAMPLE_WINDOW = 120;

class Counter {
  private samples: number[] = [];
  private sum = 0;
  private _max = 0;
  private _calls = 0;

  add(ms: number): void {
    this._calls++;
    this.samples.push(ms);
    this.sum += ms;
    if (ms > this._max) this._max = ms;
    if (this.samples.length > SAMPLE_WINDOW) {
      const removed = this.samples.shift()!;
      this.sum -= removed;
      // _max can drift below the true windowed max after eviction. The
      // overlay shows it as a "peak observed since reset" value, so this
      // is acceptable — it's the rolling max, not a per-sample max.
    }
  }

  avg(): number {
    return this.samples.length > 0 ? this.sum / this.samples.length : 0;
  }

  max(): number {
    return this._max;
  }

  calls(): number {
    return this._calls;
  }

  reset(): void {
    this.samples.length = 0;
    this.sum = 0;
    this._max = 0;
    this._calls = 0;
  }
}

const counters = new Map<string, Counter>();
let _enabled = false;

/**
 * Latest snapshot of counters from a remote context (typically the
 * simulation worker streaming its `tick.*` / `exec.*` / `spatial.*`
 * counters back to the main thread). The PerformanceOverlay merges
 * these into the local snapshot so the user sees one sorted top-N list
 * regardless of which thread the work happens on.
 */
let _remoteSamples: PerfSample[] = [];

function getCounter(name: string): Counter {
  let c = counters.get(name);
  if (c === undefined) {
    c = new Counter();
    counters.set(name, c);
  }
  return c;
}

/**
 * Enable or disable all perf instrumentation. When disabled, every
 * {@link perfBegin} returns the disabled sentinel and {@link perfEnd}
 * short-circuits without touching `performance.now()`.
 *
 * Disabling clears the registry so the next enable starts fresh.
 */
export function perfEnable(on: boolean): void {
  _enabled = on;
  if (!on) {
    for (const c of counters.values()) c.reset();
  }
}

export function perfIsEnabled(): boolean {
  return _enabled;
}

/**
 * Open a measurement scope. Returns an opaque token to be passed to
 * {@link perfEnd}; when instrumentation is disabled, returns -1 and the
 * matching {@link perfEnd} call is a no-op.
 */
export function perfBegin(_name: string): number {
  return _enabled ? performance.now() : -1;
}

export function perfEnd(name: string, token: number): void {
  if (token < 0) return;
  getCounter(name).add(performance.now() - token);
}

/**
 * Convenience wrapper for one-shot measurement. Returns the wrapped
 * function's value unchanged.
 */
export function perfMeasure<T>(name: string, fn: () => T): T {
  if (!_enabled) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    getCounter(name).add(performance.now() - t0);
  }
}

/**
 * Add a pre-measured duration directly. Used by call-sites that already
 * have a delta in hand and don't want to round-trip through begin/end.
 */
export function perfRecord(name: string, ms: number): void {
  if (!_enabled) return;
  getCounter(name).add(ms);
}

export interface PerfSample {
  name: string;
  avg: number;
  max: number;
  calls: number;
}

/**
 * Snapshot every active counter, sorted by average ms descending so the
 * dominant cost is at the top. Cheap (no per-counter allocation beyond the
 * returned array).
 */
export function perfSnapshot(): PerfSample[] {
  const out: PerfSample[] = [];
  for (const [name, c] of counters) {
    if (c.calls() === 0) continue;
    out.push({
      name,
      avg: c.avg(),
      max: c.max(),
      calls: c.calls(),
    });
  }
  out.sort((a, b) => b.avg - a.avg);
  return out;
}

/**
 * Snapshot of local counters merged with the most recent remote snapshot
 * (set via {@link perfSetRemoteSnapshot}). Used by the overlay so the
 * displayed list spans both the renderer and the simulation worker.
 */
export function perfSnapshotMerged(): PerfSample[] {
  const out = perfSnapshot();
  for (const r of _remoteSamples) out.push(r);
  out.sort((a, b) => b.avg - a.avg);
  return out;
}

export function perfSetRemoteSnapshot(samples: PerfSample[]): void {
  _remoteSamples = samples;
}

export function perfReset(): void {
  for (const c of counters.values()) c.reset();
  _remoteSamples = [];
}
