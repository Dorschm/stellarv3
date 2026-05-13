// @vitest-environment node
import { BattlecruiserExecution } from "../../../src/core/execution/BattlecruiserExecution";
import { OrbitalStrikePlatformExecution } from "../../../src/core/execution/OrbitalStrikePlatformExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

/**
 * Issue #8 regression — a Battlecruiser-hosted Orbital Strike Platform must
 * filter ship targets through `Player.canAttackPlayer`, not just the
 * `isFriendly` half of that check. The `isImmune` arm of `canAttackPlayer`
 * gates spawn-immunity: skipping it lets a hosted OSP open fire on freshly
 * spawned humans/nations, violating the same protection the ground-target
 * path already honors.
 */

const gameID: GameID = "osp_ship_target_game";

let game: Game;
let attacker: Player;
let defender: Player;

beforeEach(async () => {
  game = await setup("big_plains", {
    infiniteCredits: true,
    instantBuild: true,
  });
  // Give the defender a long spawn-immunity window so the LRW cooldown
  // window we measure here lands inside the protected period.
  (game.config() as TestConfig).setSpawnImmunityDuration(1000);

  game.addPlayer(
    new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
  );
  game.addPlayer(
    new PlayerInfo("defender", PlayerType.Human, null, "defender_id"),
  );

  game.addExecution(
    new SpawnExecution(gameID, game.player("attacker_id").info(), game.ref(5, 5)),
    new SpawnExecution(gameID, game.player("defender_id").info(), game.ref(15, 5)),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  attacker = game.player("attacker_id");
  defender = game.player("defender_id");
});

/**
 * Build an OSP hosted on a Battlecruiser owned by `attacker` and return both
 * the cruiser and the slotted OSP unit. The OSP's execution is also
 * registered so `findShipTargetInRange` is exercised on each tick.
 */
function buildHostedOsp(): { cruiser: Unit; osp: Unit } {
  const tile = game.ref(5, 5);
  const cruiser = attacker.buildUnit(UnitType.Battlecruiser, tile, {
    patrolTile: tile,
  });
  game.addExecution(new BattlecruiserExecution(cruiser));
  const osp = attacker.buildUnit(UnitType.OrbitalStrikePlatform, tile, {});
  cruiser.setSlottedStructure(osp);
  game.addExecution(new OrbitalStrikePlatformExecution(osp));
  return { cruiser, osp };
}

describe("Hosted OSP ship targeting respects canAttackPlayer", () => {
  test("does not fire at spawn-immune enemy ship", async () => {
    expect(defender.isImmune()).toBe(true);

    const { osp } = buildHostedOsp();

    // Park an enemy cruiser well within `longRangeWeaponMaxRange`.
    const enemyCruiserTile = game.ref(15, 5);
    const enemyCruiser = defender.buildUnit(
      UnitType.Battlecruiser,
      enemyCruiserTile,
      { patrolTile: enemyCruiserTile },
    );
    game.addExecution(new BattlecruiserExecution(enemyCruiser));

    const healthBefore = enemyCruiser.health();
    executeTicks(game, 20);

    // No LRW fired → no health lost on the immune target.
    expect(enemyCruiser.health()).toBe(healthBefore);
    void osp;
  });

  test("does fire once immunity expires", async () => {
    expect(defender.isImmune()).toBe(true);

    const { osp } = buildHostedOsp();

    const enemyCruiserTile = game.ref(15, 5);
    const enemyCruiser = defender.buildUnit(
      UnitType.Battlecruiser,
      enemyCruiserTile,
      { patrolTile: enemyCruiserTile },
    );
    game.addExecution(new BattlecruiserExecution(enemyCruiser));

    // Drop the immunity window so the gate flips to "can attack".
    (game.config() as TestConfig).setSpawnImmunityDuration(0);
    expect(defender.isImmune()).toBe(false);

    const healthBefore = enemyCruiser.health();
    executeTicks(game, 30);

    expect(enemyCruiser.health()).toBeLessThan(healthBefore);
    // Sanity: the slotted OSP is still alive and the hosting cruiser is
    // still ours — otherwise the damage drop would be ambiguous.
    expect(osp.isActive()).toBe(true);
  });
});
