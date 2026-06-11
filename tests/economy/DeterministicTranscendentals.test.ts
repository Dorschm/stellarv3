// @vitest-environment node
import { describe, expect, test } from "vitest";
import { DefaultConfig } from "../../src/core/configuration/DefaultConfig";
import { Difficulty, UnitType } from "../../src/core/game/Game";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { detExp, detLog, detPow, detPow2, sigmoid } from "../../src/core/Util";
import { TestServerConfig } from "../util/TestServerConfig";

/**
 * Determinism guard: ECMA-262 only requires Math.exp / Math.log / Math.pow to
 * be implementation-approximated, so different engines may differ in the last
 * ULP — enough to flip a Math.floor/BigInt conversion and desync the lockstep
 * sim (see tradeFreighterCredits). detExp/detLog/detPow/detPow2 are built
 * from exactly-specified IEEE-754 basic ops only.
 *
 * These tests pin two things:
 *   1. the deterministic replacements stay numerically equivalent to the
 *      engine's libm versions (within far less than the 0.1% balance budget),
 *   2. the converted DefaultConfig formulas (freighter credits, spawn rate,
 *      nuke death factor, cost curves) match their legacy Math.* shapes.
 */

function makeConfig(): DefaultConfig {
  const gameConfig: GameConfig = {
    gameMap: "SolSystem" as any,
    gameMapSize: "Normal" as any,
    gameMode: "FFA" as any,
    gameType: "Singleplayer" as any,
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
  return new DefaultConfig(
    new TestServerConfig(),
    gameConfig,
    new UserSettings(),
    false,
  );
}

/** Relative difference, safe around 0. */
function relDiff(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
}

describe("detPow2", () => {
  test("matches 2**k exactly across the practical integer range", () => {
    for (let k = -1074; k <= 1023; k += 7) {
      expect(detPow2(k)).toBe(Math.pow(2, k));
    }
    // The dense small range cost curves actually use.
    for (let k = 0; k <= 64; k++) {
      expect(detPow2(k)).toBe(Math.pow(2, k));
    }
  });

  test("over/underflows like 2**k outside the finite range", () => {
    expect(detPow2(1024)).toBe(Infinity);
    expect(detPow2(-1075)).toBe(0);
    expect(detPow2(0)).toBe(1);
  });
});

describe("detExp", () => {
  test("stays within 1e-12 relative of Math.exp over the sim's range", () => {
    for (let x = -100; x <= 10; x += 0.137) {
      expect(relDiff(detExp(x), Math.exp(x))).toBeLessThan(1e-12);
    }
  });

  test("edge cases match Math.exp semantics", () => {
    expect(detExp(0)).toBe(1);
    expect(detExp(NaN)).toBeNaN();
    expect(detExp(800)).toBe(Infinity);
    expect(detExp(-800)).toBe(0);
    // Extremes of the finite domain stay close despite the larger
    // reduction error there (documented < 2e-13).
    expect(relDiff(detExp(700), Math.exp(700))).toBeLessThan(1e-12);
    expect(relDiff(detExp(-700), Math.exp(-700))).toBeLessThan(1e-12);
  });
});

describe("detLog", () => {
  test("stays within 1e-12 of Math.log over (0, 1e6]", () => {
    for (let i = -6; i <= 6; i++) {
      for (let m = 1; m < 10; m += 0.31) {
        const x = m * Math.pow(10, i);
        const expected = Math.log(x);
        const tolerance = 1e-12 * Math.max(1, Math.abs(expected));
        expect(Math.abs(detLog(x) - expected)).toBeLessThan(tolerance);
      }
    }
  });

  test("edge cases match Math.log semantics", () => {
    expect(detLog(1)).toBe(0);
    expect(detLog(0)).toBe(-Infinity);
    expect(detLog(-1)).toBeNaN();
    expect(detLog(NaN)).toBeNaN();
    expect(detLog(Infinity)).toBe(Infinity);
  });
});

describe("detPow", () => {
  test("matches Math.pow within 1e-12 for the combat-debuff domain", () => {
    // largeAttackBonus / largeAttackerSpeedBonus: base in (0, 1], non-integer
    // exponents 0.6 / 0.7 — attacker.numTilesOwned() from 100k to 16M tiles.
    for (let tiles = 100_001; tiles <= 16_000_000; tiles = tiles * 2 + 17) {
      const ratio = 100_000 / tiles;
      expect(
        relDiff(detPow(Math.sqrt(ratio), 0.7), Math.pow(Math.sqrt(ratio), 0.7)),
      ).toBeLessThan(1e-12);
      expect(relDiff(detPow(ratio, 0.6), Math.pow(ratio, 0.6))).toBeLessThan(
        1e-12,
      );
    }
  });

  test("edge cases", () => {
    expect(detPow(5, 0)).toBe(1);
    expect(detPow(1, 123.45)).toBe(1);
    expect(detPow(0, 2.5)).toBe(0);
    expect(detPow(0, -1)).toBe(Infinity);
    expect(detPow(-2, 0.5)).toBeNaN();
  });
});

describe("sigmoid (deterministic)", () => {
  test("matches the legacy Math.exp sigmoid within 1e-12", () => {
    const decayRate = Math.LN2 / 50_000;
    for (let tiles = 0; tiles <= 1_000_000; tiles += 13_337) {
      const legacy = 1 / (1 + Math.exp(-decayRate * (tiles - 150_000)));
      expect(relDiff(sigmoid(tiles, decayRate, 150_000), legacy)).toBeLessThan(
        1e-12,
      );
    }
  });

  test("midpoint is exactly one half", () => {
    // detExp(0) === 1 exactly, so the midpoint value is bit-exact.
    expect(sigmoid(200, 0.0138, 200)).toBe(0.5);
  });
});

describe("DefaultConfig formulas keep their legacy values", () => {
  const config = makeConfig();

  test("tradeFreighterCredits within 1 credit of the legacy Math.exp curve", () => {
    const debuff = config.tradeFreighterShortRangeDebuff();
    for (let dist = 0; dist <= 2_000; dist += 11) {
      const legacy = BigInt(
        Math.floor(
          75_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 50 * dist,
        ),
      );
      const actual = config.tradeFreighterCredits(dist);
      expect(typeof actual).toBe("bigint");
      const diff = actual > legacy ? actual - legacy : legacy - actual;
      expect(diff <= 1n).toBe(true);
    }
  });

  test("tradeFreighterSpawnRate within 1 of the legacy curve, exact at the midpoint", () => {
    const decayRate = Math.LN2 / 50;
    for (let n = 0; n <= 600; n += 9) {
      for (const rejections of [0, 3, 10]) {
        const legacyBase = 1 - 1 / (1 + Math.exp(-decayRate * (n - 200)));
        const legacy = Math.floor(100 / (rejections + 1) / legacyBase);
        const actual = config.tradeFreighterSpawnRate(rejections, n);
        expect(Math.abs(actual - legacy)).toBeLessThanOrEqual(1);
      }
    }
    // n = 200 sits exactly on the sigmoid midpoint: both curves floor to 200.
    expect(config.tradeFreighterSpawnRate(0, 200)).toBe(200);
  });

  test("nukeDeathFactor (cluster submunition) within 1e-12 relative of legacy", () => {
    const maxPopulation = 1_000_000;
    for (let humans = 0; humans <= maxPopulation; humans += 37_777) {
      const targetPopulation = 0.03 * maxPopulation;
      const excess = Math.max(0, humans - targetPopulation);
      const legacy = 500 * (1 - Math.exp(-2 * (excess / maxPopulation)));
      const actual = config.nukeDeathFactor(
        UnitType.ClusterWarheadSubmunition,
        humans,
        1_000,
        maxPopulation,
      );
      if (legacy === 0) {
        expect(actual).toBe(0);
      } else {
        expect(relDiff(actual, legacy)).toBeLessThan(1e-12);
      }
    }
  });

  test("doubling cost curves are bit-identical to the legacy Math.pow(2, n)", () => {
    // DefenseStation / PointDefenseArray / Colony / Foundry / JumpGate cost
    // ladders switched Math.pow(2, numUnits) → detPow2(numUnits); powers of
    // two are exact in both, so the ladder must not move at all.
    for (let n = 0; n <= 40; n++) {
      expect(Math.min(800_000, detPow2(n) * 50_000)).toBe(
        Math.min(800_000, Math.pow(2, n) * 50_000),
      );
      expect(Math.min(6_000_000, detPow2(n) * 1_500_000)).toBe(
        Math.min(6_000_000, Math.pow(2, n) * 1_500_000),
      );
      expect(Math.min(1_000_000, detPow2(n) * 125_000)).toBe(
        Math.min(1_000_000, Math.pow(2, n) * 125_000),
      );
      expect(Math.min(2_000_000, detPow2(n) * 125_000)).toBe(
        Math.min(2_000_000, Math.pow(2, n) * 125_000),
      );
    }
  });
});
