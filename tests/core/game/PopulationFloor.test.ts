import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

let game: Game;
let player: Player;

// Regression: a player nuked or fleet-drained to 0 population used to be
// stuck forever — logistic growth is 0 at population 0, an absorbing state,
// and `isAlive()` keys off tiles (not population), so the player stayed alive
// but frozen. The fix reserves a survival floor on every population loss and
// seeds growth off that floor. See Config.minPopulation,
// PlayerImpl.removePopulation, and DefaultConfig.troopIncreaseRate.
describe("population survival floor and recovery from zero", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteCredits: true, instantBuild: true },
      [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");

    // Give the player territory so they count as alive (isAlive === tiles > 0).
    for (let x = 5; x < 20; x++) {
      for (let y = 5; y < 20; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          player.conquer(tile);
        }
      }
    }
  });

  test("removePopulation cannot drain a living player below the survival floor", () => {
    const floor = game.config().minPopulation(player);
    expect(floor).toBeGreaterThan(0);
    expect(player.isAlive()).toBe(true);

    player.setPopulation(5_000);
    // Attempt to remove far more than they have — the floor must be reserved.
    const removed = player.removePopulation(1_000_000);

    expect(player.population()).toBe(floor);
    // Conservation: the return value reports only what was actually removed,
    // so transfer callers (donate / freighter / attack) stay balanced.
    expect(removed).toBe(5_000 - floor);
  });

  test("a living player parked at the floor recovers over time", () => {
    const floor = game.config().minPopulation(player);
    player.setPopulation(floor);

    // Logistic growth seeded off the floor must be strictly positive, so a
    // devastated player climbs back instead of being frozen near zero.
    expect(game.config().troopIncreaseRate(player)).toBeGreaterThan(0);

    // Drive real per-tick growth: PlayerExecution applies troopIncreaseRate
    // every tick. A manually-built test player never went through
    // SpawnExecution (which normally adds it), so add it explicitly, then
    // confirm the population actually climbs back from the floor.
    const before = player.population();
    game.addExecution(new PlayerExecution(player));
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(player.population()).toBeGreaterThan(before);
  });

  test("a dead player (no tiles) can still reach 0 population", () => {
    // Relinquish every tile so the player is no longer alive; a dead player
    // has no survival floor and can be fully zeroed.
    for (const tile of Array.from(player.tiles())) {
      player.relinquish(tile);
    }
    expect(player.isAlive()).toBe(false);

    player.setPopulation(5_000);
    const removed = player.removePopulation(5_000);

    expect(player.population()).toBe(0);
    expect(removed).toBe(5_000);
  });
});
