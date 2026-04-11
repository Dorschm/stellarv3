// Provide a minimal localStorage stub for node environment.
// UserSettings reads localStorage; this stub returns null for all keys so
// all settings fall back to their defaults.
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = {
    getItem: (_key: string) => null,
    setItem: (_key: string, _value: string) => {},
    removeItem: (_key: string) => {},
    clear: () => {},
  };
}

import { placeName } from "../../src/client/NameBoxCalculator";
import { Config } from "../../src/core/configuration/Config";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Execution,
  Game,
  NameViewData,
  PlayerInfo,
} from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";
import { GameUpdateViewData } from "../../src/core/game/GameUpdates";
import { GameView } from "../../src/core/game/GameView";
import { TerrainMapData } from "../../src/core/game/TerrainMapLoader";
import { ClientID, GameID } from "../../src/core/Schemas";
import { WorkerClient } from "../../src/core/worker/WorkerClient";
import { setup } from "../util/Setup";

/**
 * Creates a minimal mock WorkerClient sufficient for GameView construction.
 * GameView only calls worker methods for async queries (player actions, buildables, etc.)
 * which are not exercised by these integration tests.
 */
function createMockWorkerClient(): WorkerClient {
  return {
    playerInteraction: () => Promise.resolve({} as any),
    playerBuildables: () => Promise.resolve([]),
    playerBorderTiles: () => Promise.resolve({ borderTiles: [] } as any),
    playerProfile: () => Promise.resolve({} as any),
    transportShipSpawn: () => Promise.resolve(false),
    attackClusteredPositions: () => Promise.resolve([]),
  } as unknown as WorkerClient;
}

/**
 * A test harness that connects a server-side Game to a client-side GameView.
 * Each call to `executeTick()` runs a game tick and feeds the resulting
 * GameUpdateViewData into the GameView, keeping it in sync.
 */
export class GameViewTestHarness {
  public readonly game: Game;
  public readonly gameView: GameView;
  private playerViewData: Record<string, NameViewData> = {};

  constructor(
    game: Game,
    config: Config,
    mapData: TerrainMapData,
    myClientID?: ClientID,
  ) {
    this.game = game;
    this.gameView = new GameView(
      createMockWorkerClient(),
      config,
      mapData,
      myClientID,
      myClientID ?? "",
      null,
      "test_game" as GameID,
      [],
    );
  }

  /**
   * Execute a single game tick and update the GameView with the results.
   */
  executeTick(): void {
    const updates = this.game.executeNextTick();

    // Compute name view data for players (same logic as GameRunner)
    if (this.game.ticks() < 3 || this.game.ticks() % 30 === 0) {
      this.game.players().forEach((p) => {
        this.playerViewData[p.id()] = placeName(this.game, p);
      });
    }

    const packedTileUpdates = this.game.drainPackedTileUpdates();
    const packedTerrainUpdates = this.game.drainPackedTerrainUpdates();
    const packedMotionPlans = this.game.drainPackedMotionPlans();

    const viewData: GameUpdateViewData = {
      tick: this.game.ticks(),
      packedTileUpdates,
      packedTerrainUpdates,
      ...(packedMotionPlans ? { packedMotionPlans } : {}),
      updates,
      playerNameViewData: this.playerViewData,
      tickExecutionDuration: 0,
      pendingTurns: 0,
    };

    this.gameView.update(viewData);
  }

  /**
   * Execute multiple game ticks.
   */
  executeTicks(n: number): void {
    for (let i = 0; i < n; i++) {
      this.executeTick();
    }
  }

  /**
   * Run ticks until the spawn phase ends.
   */
  executeUntilSpawnPhaseEnds(): void {
    while (this.game.inSpawnPhase()) {
      this.executeTick();
    }
  }

  /**
   * Add executions to the game.
   */
  addExecution(...execs: Execution[]): void {
    this.game.addExecution(...execs);
  }

  /**
   * Spawn a player at a given tile.
   */
  spawnPlayer(
    playerInfo: PlayerInfo,
    tile: TileRef,
    gameID: GameID = "test_game" as GameID,
  ): void {
    const player = this.game.player(playerInfo.id);
    this.game.addExecution(new SpawnExecution(gameID, player.info(), tile));
  }
}

/**
 * Create a GameViewTestHarness with a fully initialized Game.
 */
export async function setupGameViewTest(
  mapName: string,
  gameConfig: Record<string, unknown> = {},
  humans: PlayerInfo[] = [],
): Promise<GameViewTestHarness> {
  const game = await setup(mapName, gameConfig as any, humans);
  const config = game.config();

  // Build TerrainMapData from the game's map
  const mapData: TerrainMapData = {
    nations: [],
    gameMap: game.map(),
    miniGameMap: game.map(), // Use same map for mini in tests
  };

  const myClientID =
    humans.length > 0 ? (humans[0].clientID ?? undefined) : undefined;
  return new GameViewTestHarness(game, config, mapData, myClientID);
}
