import { NukeExecution } from "../src/core/execution/NukeExecution";
import { OrbitalStrikePlatformExecution } from "../src/core/execution/OrbitalStrikePlatformExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

const gameID: GameID = "game_id";
let game: Game;
let attacker: Player;

function attackerBuildsNuke(
  source: TileRef | null,
  target: TileRef,
  initialize = true,
) {
  game.addExecution(
    new NukeExecution(UnitType.AntimatterTorpedo, attacker, target, source),
  );
  if (initialize) {
    game.executeNextTick();
    game.executeNextTick();
  }
}

describe("OrbitalStrikePlatform", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });
    const attacker_info = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attacker_info);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(attacker_info.id).info(),
        game.ref(1, 1),
      ),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");

    constructionExecution(game, attacker, 1, 1, UnitType.OrbitalStrikePlatform);
  });

  test("orbital strike platform should launch nuke", async () => {
    attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(1);
    expect(attacker.units(UnitType.AntimatterTorpedo)[0].tile()).not.toBe(
      game.map().ref(7, 7),
    );

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }
    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(0);
  });

  test("orbital strike platform should only launch one nuke at a time", async () => {
    attackerBuildsNuke(null, game.ref(7, 7));
    attackerBuildsNuke(null, game.ref(7, 7));
    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(1);
  });

  test("orbital strike platform should cooldown as long as configured", async () => {
    expect(
      attacker.units(UnitType.OrbitalStrikePlatform)[0].isInCooldown(),
    ).toBeFalsy();
    // send the nuke far enough away so it doesn't destroy the silo
    attackerBuildsNuke(null, game.ref(50, 50));
    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(1);

    for (let i = 0; i < game.config().orbitalStrikeCooldown() - 2; i++) {
      game.executeNextTick();
      expect(
        attacker.units(UnitType.OrbitalStrikePlatform)[0].isInCooldown(),
      ).toBeTruthy();
    }

    executeTicks(game, 2);

    expect(
      attacker.units(UnitType.OrbitalStrikePlatform)[0].isInCooldown(),
    ).toBeFalsy();
  });

  test("orbital strike platform should have increased level after upgrade", async () => {
    expect(attacker.units(UnitType.OrbitalStrikePlatform)[0].level()).toEqual(
      1,
    );

    const upgradeStructureExecution = new UpgradeStructureExecution(
      attacker,
      attacker.units(UnitType.OrbitalStrikePlatform)[0].id(),
    );
    game.addExecution(upgradeStructureExecution);
    executeTicks(game, 2);

    expect(attacker.units(UnitType.OrbitalStrikePlatform)[0].level()).toEqual(
      2,
    );
  });
});

/**
 * GDD §8 / Ticket 8 — OSP teardown must finalize pending LRW impacts.
 *
 * The OrbitalStrikePlatformExecution maintains a local queue of in-flight
 * LRW impacts that mirror entries in the Game-level intercept registry. If
 * the firing platform is destroyed mid-flight, every queued entry must be
 * deterministically removed from the registry — otherwise the registry
 * leaks tokens and DefenseStations could spend their cooldown intercepting
 * a phantom shot whose impact will never actually be applied.
 *
 * This describe block uses its own bare setup (no construction-execution
 * OSP in beforeEach) so the test can build a single OSP, capture its exact
 * pending-impact tokens, and verify the registry is empty after teardown
 * without interference from other in-flight impacts.
 */
describe("OrbitalStrikePlatform LRW teardown (Ticket 8)", () => {
  test("destroying the OSP cancels its in-flight LRW impacts and leaves no orphaned registry tokens", async () => {
    const teardownGame = await setup("plains", {
      infiniteCredits: true,
      instantBuild: true,
    });

    const attackerInfo = new PlayerInfo(
      "teardown_attacker",
      PlayerType.Human,
      null,
      "teardown_attacker",
    );
    const defenderInfo = new PlayerInfo(
      "teardown_defender",
      PlayerType.Human,
      null,
      "teardown_defender",
    );
    teardownGame.addPlayer(attackerInfo);
    teardownGame.addPlayer(defenderInfo);
    teardownGame.addExecution(
      new SpawnExecution(gameID, attackerInfo, teardownGame.ref(1, 1)),
      new SpawnExecution(gameID, defenderInfo, teardownGame.ref(15, 1)),
    );
    while (teardownGame.inSpawnPhase()) {
      teardownGame.executeNextTick();
    }
    const teardownAttacker = teardownGame.player("teardown_attacker");
    teardownAttacker.addCredits(500_000n);

    // Slow the LRW projectile to a crawl so the impact tick lands well
    // after we destroy the platform. With a tile-per-tick speed of 1
    // and a ~14-tile distance, the projectile takes ~14 ticks to land.
    // Same `as unknown as` config-patching trick used elsewhere in the
    // codebase to override a single config method for a single test.
    const cfg = teardownGame.config() as unknown as {
      longRangeWeaponProjectileSpeed(): number;
    };
    const originalSpeed = cfg.longRangeWeaponProjectileSpeed;
    cfg.longRangeWeaponProjectileSpeed = () => 1;

    try {
      // Build the OSP and wire its execution. We use buildUnit + manual
      // execution add (rather than ConstructionExecution) so the platform
      // is immediately active and we control the execution handle.
      const platform = teardownAttacker.buildUnit(
        UnitType.OrbitalStrikePlatform,
        teardownGame.ref(1, 1),
        {},
      );
      const exec = new OrbitalStrikePlatformExecution(platform);
      teardownGame.addExecution(exec);

      // Tick a few times so the OSP arms and fires its first LRW shot.
      // Execution init runs on the first added tick; tick() runs from
      // the next call onwards.
      executeTicks(teardownGame, 3);
      expect(exec.pendingLrwImpactCount()).toBeGreaterThanOrEqual(1);

      // Capture the in-flight impact tokens via the registry. The
      // platform tile is the canonical query origin and we use the full
      // LRW envelope as the search range so we catch every queued
      // impact owned by this attacker.
      const queryRange = teardownGame.config().defaultNukeTargetableRange();
      const inFlight = teardownGame.pendingLrwImpactsNear(
        platform.tile(),
        queryRange,
      );
      const ourTokens = inFlight
        .filter((i) => i.ownerSmallID === teardownAttacker.smallID())
        .map((i) => i.token);
      expect(ourTokens.length).toBeGreaterThanOrEqual(1);

      // Destroy the platform mid-flight. UnitImpl.delete flips _active
      // to false; the OSP execution detects that on its next tick().
      platform.delete();
      expect(platform.isActive()).toBe(false);

      // Tick once more so the execution runs its teardown branch.
      teardownGame.executeNextTick();

      // The local queue must be empty.
      expect(exec.pendingLrwImpactCount()).toBe(0);

      // Every previously-captured token must be gone from the registry.
      for (const token of ourTokens) {
        expect(teardownGame.isPendingLrwImpactActive(token)).toBe(false);
      }

      // No phantom impacts owned by the attacker should remain in the
      // registry anywhere on the map.
      const stillActive = teardownGame
        .pendingLrwImpactsNear(platform.tile(), queryRange)
        .filter((i) => i.ownerSmallID === teardownAttacker.smallID());
      expect(stillActive).toEqual([]);

      // The execution itself must now be inactive so it gets reaped.
      expect(exec.isActive()).toBe(false);
    } finally {
      cfg.longRangeWeaponProjectileSpeed = originalSpeed;
    }
  });
});
