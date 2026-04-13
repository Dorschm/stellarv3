import { Difficulty, PersistedRunScore, RunScore } from "../core/game/Game";
import { generateCryptoRandomUUID } from "./Utils";

const RUN_HISTORY_KEY = "openfront_run_history";
const MAX_STORED_RUNS = 100;

/**
 * Load past run scores from localStorage.
 */
export function loadRunHistory(): PersistedRunScore[] {
  try {
    const raw = localStorage.getItem(RUN_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PersistedRunScore[];
  } catch {
    return [];
  }
}

/**
 * Save a completed run to localStorage.
 */
export function saveRunScore(
  runScore: RunScore,
  mapName: string,
  mapSeed: number | null,
  result: "win" | "loss",
): PersistedRunScore | null {
  try {
    const history = loadRunHistory();
    const entry: PersistedRunScore = {
      ...runScore,
      id: generateCryptoRandomUUID(),
      date: new Date().toISOString(),
      mapSeed,
      mapName,
      result,
    };
    history.push(entry);
    while (history.length > MAX_STORED_RUNS) {
      history.shift();
    }
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(history));
    return entry;
  } catch (e) {
    console.warn("[RunHistory] Failed to save run score:", e);
    return null;
  }
}

export function writeRunHistory(runs: PersistedRunScore[]): void {
  try {
    const trimmed = runs.slice(-MAX_STORED_RUNS);
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("[RunHistory] Failed to write run history:", e);
  }
}

export function mergeRunHistory(
  local: PersistedRunScore[],
  remote: PersistedRunScore[],
): {
  merged: PersistedRunScore[];
  localOnly: PersistedRunScore[];
} {
  const seen = new Set<string>();
  const merged: PersistedRunScore[] = [];
  const dedupe = (entry: PersistedRunScore) => {
    const key =
      entry.id ?? `${entry.date}|${entry.mapName}|${entry.totalTicks}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(entry);
  };
  remote.forEach(dedupe);
  const localOnly: PersistedRunScore[] = [];
  for (const entry of local) {
    const key =
      entry.id ?? `${entry.date}|${entry.mapName}|${entry.totalTicks}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
    localOnly.push(entry);
  }
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return { merged, localOnly };
}

/**
 * Count the number of wins in run history.
 */
export function countWins(): number {
  return loadRunHistory().filter((r) => r.result === "win").length;
}

/**
 * GDD §10 — AI difficulty scales with the player's run win count.
 * Easy → Medium → Hard → Impossible. After Impossible, AI gets
 * additional multipliers (handled by the caller via the returned level).
 *
 * Only applies when permadeath is enabled (roguelike mode).
 */
export function aiDifficultyForWinCount(wins: number): Difficulty {
  if (wins <= 0) return Difficulty.Easy;
  if (wins <= 2) return Difficulty.Medium;
  if (wins <= 5) return Difficulty.Hard;
  return Difficulty.Impossible;
}
