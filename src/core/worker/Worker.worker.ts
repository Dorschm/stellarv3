import { assetUrl } from "../AssetUrls";
import { createGameRunner, GameRunner } from "../GameRunner";
import { FetchGameMapLoader } from "../game/FetchGameMapLoader";
import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ErrorUpdate, GameUpdateViewData } from "../game/GameUpdates";
import type { GameUpdateViewDataWithHabitabilityDamage } from "./WorkerClient";
import {
  AssaultShuttleSpawnResultMessage,
  AttackClusteredPositionsResultMessage,
  InitializedMessage,
  MainThreadMessage,
  PlayerActionsResultMessage,
  PlayerBorderTilesResultMessage,
  PlayerBuildablesResultMessage,
  PlayerProfileResultMessage,
  WorkerMessage,
  WorkerMessageType,
} from "./WorkerMessages";

const ctx: Worker = self as any;
globalThis.__ASSET_MANIFEST__ = __ASSET_MANIFEST__;
let gameRunner: Promise<GameRunner> | null = null;
const mapLoader = new FetchGameMapLoader((path) => assetUrl(`maps/${path}`));
// Yield threshold; not a backlog cap. Used to avoid monopolizing the worker task
// and flooding the main thread with messages during catch-up.
const MAX_TICKS_BEFORE_YIELD = 4;

let drainScheduled = false;
let draining = false;
let drainRequested = false;
// Latched when the sim throws mid-tick. GameRunner advances currTurn before
// the throw, so the errored tick is partially applied — executing further
// turns on top of it would silently diverge from every other client. Once
// set, no more drains run; the forwarded ErrorUpdate (see drain) lets
// ClientGameRunner show the error modal and stop the game.
let fatalSimError = false;

function scheduleDrain(): void {
  if (fatalSimError) {
    return;
  }
  drainRequested = true;
  if (drainScheduled || draining) {
    return;
  }
  drainScheduled = true;
  setTimeout(() => {
    void drain().catch((e) => {
      console.error("Worker drain failed:", e);
    });
  }, 0);
}

async function drain(): Promise<void> {
  drainScheduled = false;
  if (draining) {
    return;
  }
  if (!gameRunner) {
    return;
  }

  draining = true;
  drainRequested = false;
  let shouldContinue = false;
  try {
    const gr = await gameRunner;
    if (!gr) {
      return;
    }

    const batch: GameUpdateViewData[] = [];
    const errors: ErrorUpdate[] = [];
    const onTickUpdate = (gu: GameUpdateViewData | ErrorUpdate) => {
      if (!("updates" in gu)) {
        // ErrorUpdate — the sim threw mid-tick and GameRunner.executeNextTick
        // caught it. Collect it for forwarding after the batch flush below so
        // the ticks that completed before the error still render in order.
        errors.push(gu);
        return;
      }
      appendHabitabilityDamageUpdates(gr.game, gu);
      batch.push(gu);
    };

    // Temporarily route tick callbacks into this drain's batch.
    tickUpdateSink = onTickUpdate;

    let ticksRun = 0;
    while (ticksRun < MAX_TICKS_BEFORE_YIELD && gr.pendingTurns() > 0) {
      const ok = gr.executeNextTick(gr.pendingTurns());
      if (!ok) {
        break;
      }
      ticksRun++;
    }

    tickUpdateSink = null;

    sendGameUpdateBatch(batch);

    if (errors.length > 0) {
      fatalSimError = true;
      for (const err of errors) {
        // Forward on the singular "game_update" channel, which WorkerClient
        // routes to the same callback as batches; ClientGameRunner already
        // handles it ("errMsg" in gu → error modal + stop). GameUpdateMessage
        // is declared with a GameUpdateViewData payload, but the runtime
        // contract of WorkerClient.start's callback is
        // GameUpdateViewData | ErrorUpdate — hence the cast.
        ctx.postMessage({
          type: "game_update",
          gameUpdate: err,
        } as unknown as WorkerMessage);
      }
    }

    shouldContinue = !fatalSimError && gr.pendingTurns() > 0;
  } finally {
    tickUpdateSink = null;
    draining = false;
  }

  if (shouldContinue || drainRequested) {
    scheduleDrain();
  }
}

let tickUpdateSink: ((gu: GameUpdateViewData | ErrorUpdate) => void) | null =
  null;

function gameUpdate(gu: GameUpdateViewData | ErrorUpdate) {
  tickUpdateSink?.(gu);
}

function sendGameUpdateBatch(gameUpdates: GameUpdateViewData[]): void {
  if (gameUpdates.length === 0) {
    return;
  }

  const transfers: Transferable[] = [];
  for (const gu of gameUpdates) {
    transfers.push(gu.packedTileUpdates.buffer);
    transfers.push(gu.packedTerrainUpdates.buffer);
    if (gu.packedMotionPlans) {
      transfers.push(gu.packedMotionPlans.buffer);
    }
  }

  ctx.postMessage(
    {
      type: "game_update_batch",
      gameUpdates,
    } as WorkerMessage,
    transfers,
  );
}

function sendMessage(message: WorkerMessage) {
  ctx.postMessage(message);
}

/**
 * Reply to a request/response RPC whose handler failed. The result-message
 * shapes in WorkerMessages.ts don't model an error variant, so the reply
 * reuses the matching result `type` and carries an `error` string instead of
 * a `result`; WorkerClient.awaitResult rejects the pending promise when it
 * sees one. Without a reply, a throwing handler would leave the main-thread
 * promise pending forever and leak its messageHandlers entry.
 */
function sendErrorResult(
  type: WorkerMessageType,
  id: string | undefined,
  error: unknown,
): void {
  ctx.postMessage({
    type,
    id,
    error: error instanceof Error ? error.message : String(error),
  } as unknown as WorkerMessage);
}

// Last habitability-damage value shipped to the main thread, per tile. LRW
// strikes write damage straight into the sim's SectorMap
// (OrbitalStrikePlatformExecution.applyLrwImpact) without emitting any
// GameUpdate, so after each tick the drain diffs the authoritative overlay
// against this snapshot and attaches the new `[tileRef, damageDelta]` pairs
// to that tick's view data for GameView.update() to replay into the
// client-side SectorMap mirror. Damage only ever accumulates (it saturates
// at the tile's base habitability), so entries are never removed.
const sentHabitabilityDamage = new Map<TileRef, number>();

function appendHabitabilityDamageUpdates(
  game: Game,
  gu: GameUpdateViewData,
): void {
  // The overlay is private to SectorMap; read it structurally (the same
  // pattern GameView uses to wire setSectorMap into DefaultConfig) so a
  // rename degrades to "no mirror" instead of a crash.
  const overlay = (
    game.sectorMap() as unknown as {
      habitabilityDamage?: ReadonlyMap<TileRef, number>;
    }
  ).habitabilityDamage;
  if (!(overlay instanceof Map) || overlay.size === 0) {
    return;
  }
  let pairs: number[] | null = null;
  for (const [tile, damage] of overlay) {
    const prev = sentHabitabilityDamage.get(tile) ?? 0;
    if (damage === prev) {
      continue;
    }
    pairs ??= [];
    pairs.push(tile, damage - prev);
    sentHabitabilityDamage.set(tile, damage);
  }
  if (pairs !== null) {
    (gu as GameUpdateViewDataWithHabitabilityDamage).habitabilityDamageUpdates =
      pairs;
  }
}

ctx.addEventListener("message", async (e: MessageEvent<MainThreadMessage>) => {
  const message = e.data;

  switch (message.type) {
    case "init":
      try {
        gameRunner = createGameRunner(
          message.gameStartInfo,
          message.clientID,
          mapLoader,
          gameUpdate,
        ).then((gr) => {
          sendMessage({
            type: "initialized",
            id: message.id,
          } as InitializedMessage);
          return gr;
        });
      } catch (error) {
        console.error("Failed to initialize game runner:", error);
        throw error;
      }
      break;

    case "turn":
      if (!gameRunner) {
        throw new Error("Game runner not initialized");
      }

      try {
        const gr = await gameRunner;
        gr.addTurn(message.turn);
        scheduleDrain();
      } catch (error) {
        console.error("Failed to process turn:", error);
        throw error;
      }
      break;

    case "player_actions":
      if (!gameRunner) {
        sendErrorResult(
          "player_actions_result",
          message.id,
          "Game runner not initialized",
        );
        break;
      }

      try {
        const actions = (await gameRunner).playerActions(
          message.playerID,
          message.x,
          message.y,
          message.units,
        );
        sendMessage({
          type: "player_actions_result",
          id: message.id,
          result: actions,
        } as PlayerActionsResultMessage);
      } catch (error) {
        console.error("Failed to get actions:", error);
        sendErrorResult("player_actions_result", message.id, error);
      }
      break;
    case "player_buildables":
      if (!gameRunner) {
        sendErrorResult(
          "player_buildables_result",
          message.id,
          "Game runner not initialized",
        );
        break;
      }

      try {
        const buildables = (await gameRunner).playerBuildables(
          message.playerID,
          message.x,
          message.y,
          message.units,
          message.capitalShipMode === true
            ? {
                capitalShipMode: true,
                hostBattlecruiserId: message.hostBattlecruiserId,
              }
            : undefined,
        );
        sendMessage({
          type: "player_buildables_result",
          id: message.id,
          result: buildables,
        } as PlayerBuildablesResultMessage);
      } catch (error) {
        console.error("Failed to get buildables:", error);
        sendErrorResult("player_buildables_result", message.id, error);
      }
      break;
    case "player_profile":
      if (!gameRunner) {
        sendErrorResult(
          "player_profile_result",
          message.id,
          "Game runner not initialized",
        );
        break;
      }

      try {
        const profile = (await gameRunner).playerProfile(message.playerID);
        sendMessage({
          type: "player_profile_result",
          id: message.id,
          result: profile,
        } as PlayerProfileResultMessage);
      } catch (error) {
        console.error("Failed to get profile:", error);
        sendErrorResult("player_profile_result", message.id, error);
      }
      break;
    case "player_border_tiles":
      if (!gameRunner) {
        sendErrorResult(
          "player_border_tiles_result",
          message.id,
          "Game runner not initialized",
        );
        break;
      }

      try {
        const borderTiles = (await gameRunner).playerBorderTiles(
          message.playerID,
        );
        sendMessage({
          type: "player_border_tiles_result",
          id: message.id,
          result: borderTiles,
        } as PlayerBorderTilesResultMessage);
      } catch (error) {
        console.error("Failed to get border tiles:", error);
        sendErrorResult("player_border_tiles_result", message.id, error);
      }
      break;
    case "attack_clustered_positions":
      if (!gameRunner) {
        // Mirror the catch below: this RPC's reply shape carries `attacks`
        // (not `result`), so reply empty rather than with an error variant.
        sendMessage({
          type: "attack_clustered_positions_result",
          id: message.id,
          attacks: [],
        } as AttackClusteredPositionsResultMessage);
        break;
      }

      try {
        const attacks = (await gameRunner).attackClusteredPositions(
          message.playerID,
          message.attackID,
        );
        sendMessage({
          type: "attack_clustered_positions_result",
          id: message.id,
          attacks,
        } as AttackClusteredPositionsResultMessage);
      } catch (error) {
        console.error("Failed to get attack front line centers:", error);
        sendMessage({
          type: "attack_clustered_positions_result",
          id: message.id,
          attacks: [],
        } as AttackClusteredPositionsResultMessage);
      }
      break;
    case "assault_shuttle_spawn":
      if (!gameRunner) {
        sendErrorResult(
          "assault_shuttle_spawn_result",
          message.id,
          "Game runner not initialized",
        );
        break;
      }

      try {
        const spawnTile = (await gameRunner).bestShuttleSpawn(
          message.playerID,
          message.targetTile,
        );
        sendMessage({
          type: "assault_shuttle_spawn_result",
          id: message.id,
          result: spawnTile,
        } as AssaultShuttleSpawnResultMessage);
      } catch (error) {
        console.error("Failed to spawn assault shuttle:", error);
        sendErrorResult("assault_shuttle_spawn_result", message.id, error);
      }
      break;
    default:
      console.warn("Unknown message :", message);
  }
});

// Error handling
ctx.addEventListener("error", (error) => {
  console.error("Worker error:", error);
});

ctx.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in worker:", event);
});
