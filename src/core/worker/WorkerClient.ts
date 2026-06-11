import {
  BuildableUnit,
  Cell,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import { ClientID, GameStartInfo, Turn } from "../Schemas";
import { generateID } from "../Util";
import { WorkerMessage } from "./WorkerMessages";

/**
 * `GameUpdateViewData` extended with the worker-boundary habitability-damage
 * channel. Long-Range Weapon strikes apply habitability damage directly to
 * the sim's SectorMap (OrbitalStrikePlatformExecution.applyLrwImpact) without
 * emitting any GameUpdate, so the worker drain diffs the authoritative
 * overlay after each tick and ships the new flat `[tileRef, damageDelta]`
 * pairs here (see Worker.worker.ts). GameView.update() replays them into the
 * client-side SectorMap mirror so HUD economy rates stay consistent after
 * orbital strikes. Declared at this boundary (rather than GameUpdates.ts)
 * because both the producer and the consumer sit on either side of it.
 */
export type GameUpdateViewDataWithHabitabilityDamage = GameUpdateViewData & {
  habitabilityDamageUpdates?: number[];
};

export class WorkerClient {
  private worker: Worker;
  private isInitialized = false;
  private messageHandlers: Map<string, (message: WorkerMessage) => void>;
  private gameUpdateCallback?: (
    update: GameUpdateViewData | ErrorUpdate,
  ) => void;

  constructor(
    private gameStartInfo: GameStartInfo,
    private clientID: ClientID | undefined,
  ) {
    this.worker = new Worker(new URL("./Worker.worker.ts", import.meta.url), {
      type: "module",
    });
    this.messageHandlers = new Map();

    // Set up global message handler
    this.worker.addEventListener(
      "message",
      this.handleWorkerMessage.bind(this),
    );
  }

  private handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
    const message = event.data;

    switch (message.type) {
      case "game_update":
        if (this.gameUpdateCallback && message.gameUpdate) {
          this.gameUpdateCallback(message.gameUpdate);
        }
        break;
      case "game_update_batch":
        if (this.gameUpdateCallback && message.gameUpdates) {
          for (const gu of message.gameUpdates) {
            this.gameUpdateCallback(gu);
          }
        }
        break;

      case "initialized":
      default:
        if (message.id && this.messageHandlers.has(message.id)) {
          const handler = this.messageHandlers.get(message.id)!;
          handler(message);
          this.messageHandlers.delete(message.id);
        }
        break;
    }
  }

  initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageId = generateID();

      this.messageHandlers.set(messageId, (message) => {
        if (message.type === "initialized") {
          this.isInitialized = true;
          resolve();
        }
      });

      this.worker.postMessage({
        type: "init",
        id: messageId,
        gameStartInfo: this.gameStartInfo,
        clientID: this.clientID,
      });

      // Add timeout for initialization. 60s is enough for slow CI machines
      // and for the third+ consecutive game start in a Playwright worker
      // process (procedural map gen + worker bundle hot-load + JIT warmup
      // can stack to ~30s in headless Chromium under serial test load).
      setTimeout(() => {
        if (!this.isInitialized) {
          this.messageHandlers.delete(messageId);
          reject(new Error("Worker initialization timeout"));
        }
      }, 60000);
    });
  }

  start(gameUpdate: (gu: GameUpdateViewData | ErrorUpdate) => void) {
    if (!this.isInitialized) {
      throw new Error("Failed to initialize pathfinder");
    }
    this.gameUpdateCallback = gameUpdate;
  }

  /**
   * Register the reply handler for a request/response RPC. Resolves with the
   * reply's `result`; rejects when the worker reports an error (see
   * `sendErrorResult` in Worker.worker.ts), when the reply has an unexpected
   * shape, or when no reply arrives within the timeout (the pending entry is
   * deleted so it cannot leak). This extends the timeout-and-reject pattern
   * attackClusteredPositions established to the remaining RPCs — without it,
   * a worker-side throw left the promise pending forever and the
   * messageHandlers entry leaked for the session.
   */
  private awaitResult<T>(
    messageId: string,
    expectedType: WorkerMessage["type"],
    resolve: (result: T) => void,
    reject: (error: Error) => void,
  ): void {
    const timeout = setTimeout(() => {
      this.messageHandlers.delete(messageId);
      reject(new Error(`${expectedType} request timed out`));
    }, 5000);

    this.messageHandlers.set(messageId, (message) => {
      clearTimeout(timeout);
      const error = (message as { error?: string }).error;
      if (error !== undefined) {
        reject(new Error(error));
        return;
      }
      const result =
        message.type === expectedType
          ? (message as { result?: T }).result
          : undefined;
      if (result === undefined) {
        reject(
          new Error(`Unexpected ${message.type} reply for ${expectedType}`),
        );
        return;
      }
      resolve(result);
    });
  }

  sendTurn(turn: Turn) {
    if (!this.isInitialized) {
      throw new Error("Worker not initialized");
    }

    this.worker.postMessage({
      type: "turn",
      turn,
    });
  }

  playerProfile(playerID: number): Promise<PlayerProfile> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.awaitResult<PlayerProfile>(
        messageId,
        "player_profile_result",
        resolve,
        reject,
      );

      this.worker.postMessage({
        type: "player_profile",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerBorderTiles(playerID: PlayerID): Promise<PlayerBorderTiles> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.awaitResult<PlayerBorderTiles>(
        messageId,
        "player_border_tiles_result",
        resolve,
        reject,
      );

      this.worker.postMessage({
        type: "player_border_tiles",
        id: messageId,
        playerID: playerID,
      });
    });
  }

  playerInteraction(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): Promise<PlayerActions> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.awaitResult<PlayerActions>(
        messageId,
        "player_actions_result",
        resolve,
        reject,
      );

      this.worker.postMessage({
        type: "player_actions",
        id: messageId,
        playerID,
        x,
        y,
        units,
      });
    });
  }

  playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
    options?: { capitalShipMode?: boolean; hostBattlecruiserId?: number },
  ): Promise<BuildableUnit[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      this.awaitResult<BuildableUnit[]>(
        messageId,
        "player_buildables_result",
        resolve,
        reject,
      );

      this.worker.postMessage({
        type: "player_buildables",
        id: messageId,
        playerID,
        x,
        y,
        units,
        capitalShipMode: options?.capitalShipMode === true,
        hostBattlecruiserId: options?.hostBattlecruiserId,
      });
    });
  }

  attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): Promise<{ id: string; positions: Cell[] }[]> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error("attack_clustered_positions request timed out"));
      }, 5000);

      this.messageHandlers.set(messageId, (message) => {
        clearTimeout(timeout);
        if (message.type !== "attack_clustered_positions_result") {
          reject(
            new Error(
              `Unexpected message type for attackClusteredPositions: ${message.type}`,
            ),
          );
          return;
        }
        resolve(
          message.attacks.map((a) => ({
            id: a.id,
            positions: a.positions.map((c) => new Cell(c.x, c.y)),
          })),
        );
      });

      this.worker.postMessage({
        type: "attack_clustered_positions",
        id: messageId,
        playerID,
        attackID,
      });
    });
  }

  transportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): Promise<TileRef | false> {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = generateID();

      // `result` is `false` (not undefined) when no spawn tile exists, so
      // the undefined-result rejection in awaitResult stays unambiguous.
      this.awaitResult<TileRef | false>(
        messageId,
        "assault_shuttle_spawn_result",
        resolve,
        reject,
      );

      this.worker.postMessage({
        type: "assault_shuttle_spawn",
        id: messageId,
        playerID: playerID,
        targetTile: targetTile,
      });
    });
  }

  cleanup() {
    this.worker.terminate();
    this.messageHandlers.clear();
    this.gameUpdateCallback = undefined;
  }
}
