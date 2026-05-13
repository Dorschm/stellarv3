// @vitest-environment node
import { BattlecruiserExecution } from "../../../src/core/execution/BattlecruiserExecution";
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
import { executeTicks } from "../../util/utils";

/**
 * Tests for GDD §8 — "Satellites or fleets can intercept projectiles within
 * range". BattlecruiserExecution gained LRW projectile interception that
 * mirrors DefenseStationExecution's registry dance but with inverse
 * priority: a cruiser only intercepts when no ship target is engaged,
 * because the cruiser is primarily a combat ship with secondary defense.
 */

const gameID: GameID = "bc_lrw_game";

let game: Game;
let pilot: Player;
let attacker: Player;

async function buildGame() {
  game = await setup("plains", {
    infiniteCredits: true,
    instantBuild: true,
  });
  // plans/here-is-a-list-twinkly-dragonfly.md §5.2 — cap-ship LRW
  // intercept now lives behind `battlecruiserHasDefaultWeapon()` so the
  // default policy is "platform-driven combat, no default weapon". This
  // suite tests the legacy intercept code path, so opt in explicitly.
  // The method is kept callable / private precisely so this test can
  // continue to pin behaviour for the case a future revert of the
  // policy reactivates the default weapon.
  (game.config() as unknown as {
    battlecruiserHasDefaultWeapon: () => boolean;
  }).battlecruiserHasDefaultWeapon = () => true;
  game.addPlayer(
    new PlayerInfo("pilot_id", PlayerType.Human, null, "pilot_id"),
  );
  game.addPlayer(
    new PlayerInfo("attacker_id", PlayerType.Human, null, "attacker_id"),
  );
  game.addExecution(
    new SpawnExecution(gameID, game.player("pilot_id").info(), game.ref(15, 1)),
    new SpawnExecution(
      gameID,
      game.player("attacker_id").info(),
      game.ref(1, 1),
    ),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  pilot = game.player("pilot_id");
  attacker = game.player("attacker_id");
}

function spawnBattlecruiser(patrolTile: number): Unit {
  const bc = pilot.buildUnit(UnitType.Battlecruiser, patrolTile, {
    patrolTile,
  });
  game.addExecution(new BattlecruiserExecution(bc));
  return bc;
}

describe("Battlecruiser LRW intercept (GDD §8)", () => {
  beforeEach(async () => {
    await buildGame();
  });

  test("Battlecruiser intercepts a pending enemy LRW impact within range", async () => {
    const patrolTile = game.ref(15, 1);
    spawnBattlecruiser(patrolTile);
    // Let the cruiser's execution init + tick once so it's live on the
    // exec list before we register the LRW impact.
    game.executeNextTick();

    const token = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 2),
      999_999,
    );
    expect(game.isPendingLrwImpactActive(token)).toBe(true);

    // Cooldown is `battlecruiserPlasmaBoltAttackRate` ticks (20 default).
    // Tick past it so the intercept gate is open for sure.
    executeTicks(game, 25);

    expect(game.isPendingLrwImpactActive(token)).toBe(false);
  });

  test("Battlecruiser does NOT intercept allied players' LRW impacts", async () => {
    const patrolTile = game.ref(15, 1);
    spawnBattlecruiser(patrolTile);
    game.executeNextTick();

    // Form an alliance so attacker.isFriendly(pilot) is true.
    const req = attacker.createAllianceRequest(pilot);
    req!.accept();
    expect(attacker.isFriendly(pilot)).toBe(true);

    const alliedToken = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 2),
      999_999,
    );

    // Pump well past the cooldown window. The allied impact must stay
    // in the registry — the friendly filter must skip it.
    executeTicks(game, 100);

    expect(game.isPendingLrwImpactActive(alliedToken)).toBe(true);
  });

  test("Battlecruiser does NOT intercept its own owner's LRW", async () => {
    const patrolTile = game.ref(15, 1);
    spawnBattlecruiser(patrolTile);
    game.executeNextTick();

    const ownToken = game.registerPendingLrwImpact(
      pilot.smallID(),
      game.ref(15, 1),
      game.ref(15, 2),
      999_999,
    );

    executeTicks(game, 100);

    // Registry-level `excludeOwnerSmallID` already filters own impacts,
    // so this should hold — covered defensively to prevent regression.
    expect(game.isPendingLrwImpactActive(ownToken)).toBe(true);
  });

  test("Battlecruiser prioritizes ship targeting over LRW interception", async () => {
    const patrolTile = game.ref(15, 1);
    const cruiser = spawnBattlecruiser(patrolTile);
    game.executeNextTick();

    // Park a hostile AssaultShuttle directly on top of the cruiser so
    // findTargetUnit() latches onto it. We then register an LRW impact
    // also in range. On the tick where a ship target is picked, the
    // intercept branch must be skipped — that's the ship-priority gate
    // under test.
    attacker.buildUnit(UnitType.AssaultShuttle, game.ref(15, 1), {});

    const token = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 2),
      999_999,
    );

    // One tick: the cruiser picks the shuttle as targetUnit and fires
    // a plasma bolt at it. The LRW intercept sits in the `else` branch
    // of `tick()`, so it must NOT run on a tick where a ship target was
    // engaged (even though the shuttle is one-shotted and the target
    // field is cleared by end-of-tick).
    game.executeNextTick();
    void cruiser;

    expect(game.isPendingLrwImpactActive(token)).toBe(true);
  });

  test("Intercept runs before patrol movement so the cruiser holds position on intercept ticks", async () => {
    // Regression: previously `tick()` called `patrol()` before
    // `tryInterceptLrw()`, so interception was evaluated from the
    // post-move tile rather than the start-of-tick defensive position.
    // The ordering fix also means the cruiser must NOT patrol on a tick
    // where it fired an intercept — otherwise the fix is immediately
    // undone by a movement step.
    //
    // The default `buildGame()` uses "plains" (all land), where patrol
    // silently returns without moving because `randomTile()` can't find
    // a deep-space destination. That scenario can't distinguish the old
    // and new orderings. Rebuild the game on `half_land_half_ocean`
    // (x >= 8 is deep space) so the cruiser, spawned in the void half,
    // actually patrols one tile per tick under the old ordering.
    game = await setup("half_land_half_ocean", {
      infiniteCredits: true,
      instantBuild: true,
    });
    // Test-specific game rebuild — re-apply the legacy default-weapon
    // flag override that beforeEach sets on the per-suite `game`. Without
    // this the new game uses the production default (no default weapon)
    // and the intercept path doesn't run.
    (
      game.config() as unknown as {
        battlecruiserHasDefaultWeapon: () => boolean;
      }
    ).battlecruiserHasDefaultWeapon = () => true;
    game.addPlayer(
      new PlayerInfo("pilot_id", PlayerType.Human, null, "pilot_id"),
    );
    game.addPlayer(
      new PlayerInfo("attacker_id", PlayerType.Human, null, "attacker_id"),
    );
    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player("pilot_id").info(),
        game.ref(1, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player("attacker_id").info(),
        game.ref(7, 1),
      ),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    pilot = game.player("pilot_id");
    attacker = game.player("attacker_id");

    // Spawn the cruiser deep in the void half so patrol has valid
    // destinations.
    const patrolTile = game.ref(12, 8);
    const cruiser = spawnBattlecruiser(patrolTile);
    // Prime the exec: init() runs and tick() runs once. Under the old
    // order this would also patrol one tile, changing the cruiser's
    // tile from its spawn position.
    game.executeNextTick();

    const tileBefore = cruiser.tile();

    const token = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(7, 1),
      game.ref(12, 9),
      999_999,
    );

    game.executeNextTick();

    // Intercept fires from the start-of-tick position.
    expect(game.isPendingLrwImpactActive(token)).toBe(false);
    // Patrol is skipped on intercept ticks, so position is unchanged.
    // Under the old order (patrol before intercept), the cruiser would
    // have moved one tile during patrol, and this assertion would fail.
    expect(cruiser.tile()).toBe(tileBefore);
  });

  test("Intercept consumes the plasma-bolt cooldown", async () => {
    const patrolTile = game.ref(15, 1);
    spawnBattlecruiser(patrolTile);
    game.executeNextTick();

    const tokenA = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 2),
      999_999,
    );
    const tokenB = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 3),
      999_999,
    );

    // One tick is enough to fire the first intercept once the cruiser is
    // live. Advance a single tick and confirm exactly one impact remains.
    game.executeNextTick();
    const alive1 =
      (game.isPendingLrwImpactActive(tokenA) ? 1 : 0) +
      (game.isPendingLrwImpactActive(tokenB) ? 1 : 0);
    expect(alive1).toBe(1);

    // Cooldown is 20 ticks by default — after 5 more ticks we're still
    // inside the window, so the second impact must still be pending.
    executeTicks(game, 5);
    const alive2 =
      (game.isPendingLrwImpactActive(tokenA) ? 1 : 0) +
      (game.isPendingLrwImpactActive(tokenB) ? 1 : 0);
    expect(alive2).toBe(1);

    // Past the cooldown — the second intercept should fire.
    executeTicks(game, 25);
    const alive3 =
      (game.isPendingLrwImpactActive(tokenA) ? 1 : 0) +
      (game.isPendingLrwImpactActive(tokenB) ? 1 : 0);
    expect(alive3).toBe(0);
  });
});
