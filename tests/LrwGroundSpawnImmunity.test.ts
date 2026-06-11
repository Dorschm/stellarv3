// @vitest-environment node
import { OrbitalStrikePlatformExecution } from "../src/core/execution/OrbitalStrikePlatformExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

const gameID: GameID = "lrw_ground_immunity";

/**
 * Regression test: the ground-target Long-Range Weapon auto-fire picker
 * must honor spawn immunity via `canAttackPlayer` — exactly like the
 * ship-target branch, nukes, and regular attacks. It used to filter only
 * on friendliness, letting an OSP bombard players still inside their
 * immunity window.
 */
describe("Ground-target LRW respects spawn immunity", () => {
  let game: Game;
  let attacker: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });

    const attackerInfo = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    // Defender within the LRW envelope of the attacker's spawn.
    game.addExecution(
      new SpawnExecution(gameID, attackerInfo, game.ref(1, 1)),
      new SpawnExecution(gameID, defenderInfo, game.ref(15, 1)),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    attacker = game.player("attacker_id");
  });

  test("OSP holds fire while spawn immunity is active and fires once it lapses", () => {
    // Extend spawn immunity far past the current tick.
    (game.config() as TestConfig).setSpawnImmunityDuration(100_000);

    attacker.addCredits(500_000n);
    const platform = attacker.buildUnit(
      UnitType.OrbitalStrikePlatform,
      game.ref(1, 1),
      {},
    );
    const exec = new OrbitalStrikePlatformExecution(platform);
    game.addExecution(exec);

    executeTicks(game, 5);

    // Immune target: no shot scheduled, cooldown never started.
    expect(exec.pendingLrwImpactCount()).toBe(0);
    expect(exec.lrwReadyAt()).toBeLessThanOrEqual(game.ticks());

    // Lift the immunity window — the same target becomes legal.
    (game.config() as TestConfig).setSpawnImmunityDuration(0);
    executeTicks(game, 1);

    // The LRW fired: the cooldown is now well in the future.
    expect(exec.lrwReadyAt()).toBeGreaterThan(game.ticks());
  });
});
