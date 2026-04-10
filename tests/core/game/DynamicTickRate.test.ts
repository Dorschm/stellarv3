// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";

/**
 * Tests for the dynamic tick-rate scaling methods on DefaultConfig.
 * See GDD §10 — game speeds up as players expand.
 */

// Create a minimal config instance for testing
function createTestConfig(): DefaultConfig {
  const serverConfig = {
    turnIntervalMs: () => 100,
    turnstileSiteKey: () => "",
    turnstileSecretKey: () => "",
    gameCreationRate: () => 120000,
    numWorkers: () => 1,
    workerIndex: () => 0,
    workerPath: () => "w0",
    workerPort: () => 3000,
    workerPortByIndex: () => 3000,
    env: () => 0,
    adminToken: () => "",
    adminHeader: () => "",
    gitCommit: () => "",
    apiKey: () => "",
    otelEndpoint: () => "",
    otelAuthHeader: () => "",
    otelEnabled: () => false,
    jwtAudience: () => "localhost",
    jwtIssuer: () => "http://localhost",
    jwkPublicKey: () => Promise.resolve({} as any),
    domain: () => "",
    subdomain: () => "",
    stripePublishableKey: () => "",
    allowedFlares: () => undefined,
  };

  const gameConfig = {
    gameMap: "Sol System" as any,
    difficulty: "Medium" as any,
    donateCredits: false,
    donateTroops: false,
    gameType: "Singleplayer" as any,
    gameMode: "Free For All" as any,
    gameMapSize: "Normal" as any,
    nations: "default" as const,
    bots: 400,
    infiniteCredits: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    playerTeams: 2,
  };

  return new DefaultConfig(serverConfig as any, gameConfig as any, null, false);
}

describe("DynamicTickRate", () => {
  it("returns max interval at 0% expansion", () => {
    const config = createTestConfig();
    expect(config.dynamicTurnIntervalMs(0)).toBe(100);
  });

  it("returns min interval at 100% expansion", () => {
    const config = createTestConfig();
    expect(config.dynamicTurnIntervalMs(1)).toBe(50);
  });

  it("returns intermediate values for partial expansion", () => {
    const config = createTestConfig();
    const mid = config.dynamicTurnIntervalMs(0.5);
    expect(mid).toBe(75);
  });

  it("clamps values below 0", () => {
    const config = createTestConfig();
    expect(config.dynamicTurnIntervalMs(-0.5)).toBe(100);
  });

  it("clamps values above 1", () => {
    const config = createTestConfig();
    expect(config.dynamicTurnIntervalMs(2)).toBe(50);
  });

  it("min/max interval bounds are correct", () => {
    const config = createTestConfig();
    expect(config.minTurnIntervalMs()).toBe(50);
    expect(config.maxTurnIntervalMs()).toBe(100);
  });
});
