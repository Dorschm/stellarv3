import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

/**
 * Regression tests for the re-spawn order-of-operations bug: SpawnExecution
 * used to relinquish the player's existing spawn BEFORE validating the new
 * one, so a failed re-spawn (e.g. clicking a hotspot another player already
 * claimed) left the player with zero tiles — dead on the first post-spawn
 * tick. The new spawn must be validated first.
 */
describe("Spawn execution — re-spawn validation order", () => {
  test("failed re-spawn keeps the player's existing spawn", async () => {
    const aInfo = new PlayerInfo("a", PlayerType.Human, "client_a", "a_id");
    const bInfo = new PlayerInfo("b", PlayerType.Human, "client_b", "b_id");
    const game = await setup("plains", undefined, [aInfo, bInfo]);

    game.addExecution(
      new SpawnExecution("game_id", aInfo, game.ref(5, 5)),
      new SpawnExecution("game_id", bInfo, game.ref(20, 20)),
    );
    game.executeNextTick();
    game.executeNextTick();

    const a = game.player("a_id");
    const b = game.player("b_id");
    const aTilesBefore = a.numTilesOwned();
    expect(aTilesBefore).toBeGreaterThan(0);
    expect(b.numTilesOwned()).toBeGreaterThan(0);

    // Re-click A's spawn onto the center of B's territory. Every candidate
    // tile in the radius-4 spawn area is already owned by B, so the
    // re-spawn must fail — and A must keep their existing spawn.
    game.addExecution(new SpawnExecution("game_id", aInfo, game.ref(20, 20)));
    game.executeNextTick();
    game.executeNextTick();

    expect(a.numTilesOwned()).toBe(aTilesBefore);
    expect(a.spawnTile()).toBe(game.ref(5, 5));
    expect(game.owner(game.ref(20, 20))).toBe(b);
  });

  test("re-spawn overlapping the old spawn area claims the full new area", async () => {
    const aInfo = new PlayerInfo("a", PlayerType.Human, "client_a", "a_id");
    const game = await setup("plains", undefined, [aInfo]);

    game.addExecution(new SpawnExecution("game_id", aInfo, game.ref(5, 5)));
    game.executeNextTick();
    game.executeNextTick();

    const a = game.player("a_id");
    const tilesBefore = a.numTilesOwned();
    expect(tilesBefore).toBeGreaterThan(0);

    // Move the spawn two tiles over — the new radius-4 area overlaps the
    // old one. Tiles freed by the relinquish must be claimable again, so
    // the player ends up with the full disc around the new center.
    game.addExecution(new SpawnExecution("game_id", aInfo, game.ref(7, 5)));
    game.executeNextTick();
    game.executeNextTick();

    expect(a.spawnTile()).toBe(game.ref(7, 5));
    // Same-size disc on open plains: tile count is unchanged.
    expect(a.numTilesOwned()).toBe(tilesBefore);
    // Overlapping tile (dist 2 from old center, 4 from new) is owned...
    expect(game.owner(game.ref(3, 5))).toBe(a);
    // ...while the far edge of the old spawn was relinquished.
    expect(game.owner(game.ref(1, 5)).isPlayer()).toBe(false);
  });
});
