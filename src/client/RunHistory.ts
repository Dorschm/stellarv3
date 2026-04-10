import { Difficulty, PersistedRunScore, RunScore } from "../core/game/Game";

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
): void {
  try {
    const history = loadRunHistory();
    const entry: PersistedRunScore = {
      ...runScore,
      date: new Date().toISOString(),
      mapSeed,
      mapName,
      result,
    };
    history.push(entry);
    // Keep only the most recent runs
    while (history.length > MAX_STORED_RUNS) {
      history.shift();
    }
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn("[RunHistory] Failed to save run score:", e);
  }
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
