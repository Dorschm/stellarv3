import { randTerritoryTileArray } from "../src/core/execution/nation/NationUtils";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;

// Regression test: the nation nuke AI can pick a target that was eliminated
// while its target marker was still active. Sampling territory tiles from a
// 0-tile player must return nothing instead of throwing ("array must not be
// empty" in PseudoRandom.randElement), which would abort the whole game tick
// on every client.
describe("randTerritoryTileArray with a dead (0-tile) player", () => {
  beforeEach(async () => {
    game = await setup("big_plains");

    game.addPlayer(new PlayerInfo("player_id", PlayerType.Human, null, "p1"));
    player = game.player("p1");

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("returns an empty array instead of throwing for a player with no tiles", () => {
    expect(player.numTilesOwned()).toBe(0);

    const random = new PseudoRandom(1);
    expect(() =>
      randTerritoryTileArray(random, game, player, 10),
    ).not.toThrow();
    expect(randTerritoryTileArray(random, game, player, 10)).toHaveLength(0);
  });

  test("still samples tiles for a small living player", () => {
    let toConquer = 3;
    game.map().forEachTile((tile) => {
      if (toConquer > 0 && game.map().isSector(tile)) {
        player.conquer(tile);
        toConquer--;
      }
    });
    expect(player.numTilesOwned()).toBe(3);

    const random = new PseudoRandom(1);
    const tiles = randTerritoryTileArray(random, game, player, 10);
    expect(tiles).toHaveLength(10);
    for (const tile of tiles) {
      expect(game.owner(tile)).toBe(player);
    }
  });
});
