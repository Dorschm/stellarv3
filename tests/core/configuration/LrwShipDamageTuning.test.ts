// @vitest-environment node
import { describe, expect, test } from "vitest";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";
import { Difficulty, UnitType } from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { TestServerConfig } from "../../util/TestServerConfig";

/**
 * Issue #8 — the Battlecruiser-hosted OSP's LRW must remain a credible
 * anti-ship weapon. The ticket requires `lrwShipDamage()` to land at
 * roughly 2× a plasma-bolt's per-shot damage. This test pins that ratio
 * so a future plasma-bolt balance edit cannot silently regress the LRW
 * tuning back to a fraction of one plasma hit.
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

describe("lrwShipDamage tuning", () => {
  test("stays at ~2x the configured plasma-bolt damage", () => {
    const config = makeConfig();
    const plasmaDamage = config.unitInfo(UnitType.PlasmaBolt).damage ?? 250;

    expect(config.lrwShipDamage()).toBe(plasmaDamage * 2);
  });
});
