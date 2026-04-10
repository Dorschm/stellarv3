// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Difficulty, WinCondition } from "../../src/core/game/Game";

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((key) => delete store[key]);
  },
};

vi.stubGlobal("localStorage", localStorageMock);

// Import after mocking
const { loadRunHistory, saveRunScore, countWins, aiDifficultyForWinCount } =
  await import("../../src/client/RunHistory");

describe("RunHistory", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array when no history exists", () => {
    expect(loadRunHistory()).toEqual([]);
  });

  it("saves and loads a run score", () => {
    const runScore = {
      totalTicks: 1000,
      winCondition: WinCondition.Elimination,
      players: [
        {
          clientID: "c1",
          playerID: "p1",
          name: "Player 1",
          planetsConquered: 3,
          systemsControlled: 2,
          survivalTicks: 1000,
          eliminationRank: 1,
        },
      ],
    };

    saveRunScore(runScore, "Sol System", null, "win");

    const history = loadRunHistory();
    expect(history).toHaveLength(1);
    expect(history[0].mapName).toBe("Sol System");
    expect(history[0].result).toBe("win");
    expect(history[0].totalTicks).toBe(1000);
    expect(history[0].players).toHaveLength(1);
    expect(history[0].date).toBeTruthy();
  });

  it("saves multiple runs", () => {
    const runScore = {
      totalTicks: 500,
      winCondition: WinCondition.Domination,
      players: [],
    };

    saveRunScore(runScore, "Map A", 42, "win");
    saveRunScore(runScore, "Map B", 43, "loss");
    saveRunScore(runScore, "Map C", 44, "win");

    const history = loadRunHistory();
    expect(history).toHaveLength(3);
  });

  it("counts wins correctly", () => {
    const runScore = {
      totalTicks: 500,
      winCondition: WinCondition.Elimination,
      players: [],
    };

    saveRunScore(runScore, "A", null, "win");
    saveRunScore(runScore, "B", null, "loss");
    saveRunScore(runScore, "C", null, "win");

    expect(countWins()).toBe(2);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorageMock.setItem("openfront_run_history", "not valid json");
    expect(loadRunHistory()).toEqual([]);
  });

  it("handles non-array localStorage value", () => {
    localStorageMock.setItem("openfront_run_history", '"just a string"');
    expect(loadRunHistory()).toEqual([]);
  });
});

describe("aiDifficultyForWinCount", () => {
  it("returns Easy for 0 wins", () => {
    expect(aiDifficultyForWinCount(0)).toBe(Difficulty.Easy);
  });

  it("returns Medium for 1-2 wins", () => {
    expect(aiDifficultyForWinCount(1)).toBe(Difficulty.Medium);
    expect(aiDifficultyForWinCount(2)).toBe(Difficulty.Medium);
  });

  it("returns Hard for 3-5 wins", () => {
    expect(aiDifficultyForWinCount(3)).toBe(Difficulty.Hard);
    expect(aiDifficultyForWinCount(5)).toBe(Difficulty.Hard);
  });

  it("returns Impossible for 6+ wins", () => {
    expect(aiDifficultyForWinCount(6)).toBe(Difficulty.Impossible);
    expect(aiDifficultyForWinCount(100)).toBe(Difficulty.Impossible);
  });
});
