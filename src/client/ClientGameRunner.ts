import { translateText } from "../client/Utils";
import { EventBus } from "../core/EventBus";
import {
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  LobbyInfoEvent,
  PlayerCosmeticRefs,
  PlayerRecord,
  ServerMessage,
} from "../core/Schemas";
import { createPartialGameRecord, findClosestBy, replacer } from "../core/Util";
import { ServerConfig } from "../core/configuration/Config";
import { getGameLogicConfig } from "../core/configuration/ConfigLoader";
import { BuildableUnit, BuildMenus, Structures, UnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import { GameMapLoader } from "../core/game/GameMapLoader";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "../core/game/GameUpdates";
import { GameView, PlayerView } from "../core/game/GameView";
import { loadTerrainMap, TerrainMapData } from "../core/game/TerrainMapLoader";
import { UserSettings } from "../core/game/UserSettings";
import { WorkerClient } from "../core/worker/WorkerClient";
import { getPersistentID } from "./Auth";
import { GameBridge } from "./bridge/GameBridge";
import { useHUDStore } from "./bridge/HUDStore";
import {
  AutoUpgradeEvent,
  DoBoatAttackEvent,
  DoGroundAttackEvent,
  GhostStructureChangedEvent,
  MouseUpEvent,
  SceneTickEvent,
  TileHoverClearEvent,
  TileHoverEvent,
  TickMetricsEvent,
} from "./InputHandler";
import { SpaceInputHandler } from "./bridge/SpaceInputHandler";
import { endGame, startGame, startTime } from "./LocalPersistantStats";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import {
  BuildUnitIntentEvent,
  SendAttackIntentEvent,
  SendBoatAttackIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  SendUpgradeStructureIntentEvent,
  Transport,
} from "./Transport";
import { GoToPlayerEvent } from "./CameraEvents";
import { ShowPlayerPanelEvent } from "./hud/events";
import { mountReactRoot, unmountReactRoot } from "./scene/ReactRoot";
import SoundManager from "./sound/SoundManager";

export interface LobbyConfig {
  serverConfig: ServerConfig;
  cosmetics: PlayerCosmeticRefs;
  playerName: string;
  playerClanTag: string | null;
  gameID: GameID;
  turnstileToken: string | null;
  // GameStartInfo only exists when playing a singleplayer game.
  gameStartInfo?: GameStartInfo;
  // GameRecord exists when replaying an archived game.
  gameRecord?: GameRecord;
}

export interface JoinLobbyResult {
  stop: (force?: boolean) => boolean;
  prestart: Promise<void>;
  join: Promise<void>;
}

export function joinLobby(
  eventBus: EventBus,
  lobbyConfig: LobbyConfig,
): JoinLobbyResult {
  // Mutable clientID state — assigned by server (multiplayer) or derived from gameStartInfo (singleplayer)
  let clientID: ClientID | undefined;

  let resolvePrestart: () => void;
  let resolveJoin: () => void;
  const prestartPromise = new Promise<void>((r) => (resolvePrestart = r));
  const joinPromise = new Promise<void>((r) => (resolveJoin = r));

  console.log(`joining lobby: gameID: ${lobbyConfig.gameID}`);

  const userSettings: UserSettings = new UserSettings();
  startGame(lobbyConfig.gameID, lobbyConfig.gameStartInfo?.config ?? {});

  const transport = new Transport(lobbyConfig, eventBus);

  let currentGameRunner: ClientGameRunner | null = null;

  const onconnect = () => {
    // Always send join - server will detect reconnection via persistentID
    console.log(`Joining game lobby ${lobbyConfig.gameID}`);
    transport.joinGame();
  };
  let terrainLoad: Promise<TerrainMapData> | null = null;

  const onmessage = (message: ServerMessage) => {
    if (message.type === "lobby_info") {
      // Server tells us our assigned clientID
      clientID = message.myClientID;
      eventBus.emit(new LobbyInfoEvent(message.lobby, message.myClientID));
      return;
    }
    if (message.type === "prestart") {
      console.log(
        `lobby: game prestarting: ${JSON.stringify(message, replacer)}`,
      );
      terrainLoad = loadTerrainMap(
        message.gameMap,
        message.gameMapSize,
        terrainMapFileLoader,
      );
      resolvePrestart();
    }
    if (message.type === "start") {
      // Trigger prestart for singleplayer games
      resolvePrestart();
      console.log(
        `lobby: game started: ${JSON.stringify(message, replacer, 2)}`,
      );
      // Server tells us our assigned clientID (also sent on start for late joins)
      clientID = message.myClientID;
      resolveJoin();
      // For multiplayer games, GameStartInfo is not known until game starts.
      lobbyConfig.gameStartInfo = message.gameStartInfo;
      createClientGame(
        lobbyConfig,
        clientID,
        eventBus,
        transport,
        userSettings,
        terrainLoad,
        terrainMapFileLoader,
      )
        .then((r) => {
          currentGameRunner = r;
          r.start();
        })
        .catch((e) => {
          console.error("error creating client game", e);

          currentGameRunner = null;

          const startingModal = document.querySelector(
            "game-starting-modal",
          ) as HTMLElement;
          if (startingModal) {
            startingModal.classList.add("hidden");
          }
          showErrorModal(
            e.message,
            e.stack,
            lobbyConfig.gameID,
            clientID,
            true,
            false,
            "error_modal.connection_error",
          );
        });
    }
    if (message.type === "error") {
      if (message.error === "full-lobby") {
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID, cause: "full-lobby" },
            bubbles: true,
            composed: true,
          }),
        );
      } else if (message.error === "kick_reason.host_left") {
        alert(translateText("kick_reason.host_left"));
        document.dispatchEvent(
          new CustomEvent("leave-lobby", {
            detail: { lobby: lobbyConfig.gameID, cause: "host-left" },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
        showErrorModal(
          message.error,
          message.message,
          lobbyConfig.gameID,
          clientID,
          true,
          false,
          "error_modal.connection_error",
        );
      }
    }
  };
  transport.connect(onconnect, onmessage);
  return {
    stop: (force: boolean = false) => {
      if (!force && currentGameRunner?.shouldPreventWindowClose()) {
        console.log("Player is active, prevent leaving game");
        return false;
      }
      console.log("leaving game");
      currentGameRunner?.stop();
      currentGameRunner = null;
      transport.leaveGame();
      return true;
    },
    prestart: prestartPromise,
    join: joinPromise,
  };
}

async function createClientGame(
  lobbyConfig: LobbyConfig,
  clientID: ClientID | undefined,
  eventBus: EventBus,
  transport: Transport,
  userSettings: UserSettings,
  terrainLoad: Promise<TerrainMapData> | null,
  mapLoader: GameMapLoader,
): Promise<ClientGameRunner> {
  if (lobbyConfig.gameStartInfo === undefined) {
    throw new Error("missing gameStartInfo");
  }
  const config = await getGameLogicConfig(
    lobbyConfig.gameStartInfo.config,
    userSettings,
    lobbyConfig.gameRecord !== undefined,
  );
  let gameMap: TerrainMapData | null = null;

  if (terrainLoad) {
    gameMap = await terrainLoad;
  } else {
    gameMap = await loadTerrainMap(
      lobbyConfig.gameStartInfo.config.gameMap,
      lobbyConfig.gameStartInfo.config.gameMapSize,
      mapLoader,
    );
  }
  const worker = new WorkerClient(lobbyConfig.gameStartInfo, clientID);
  await worker.initialize();
  const gameView = new GameView(
    worker,
    config,
    gameMap,
    clientID,
    lobbyConfig.playerName,
    lobbyConfig.playerClanTag,
    lobbyConfig.gameStartInfo.gameID,
    lobbyConfig.gameStartInfo.players,
  );

  // Create the bridge that syncs GameView -> Zustand HUDStore each tick
  const bridge = new GameBridge(gameView, clientID);

  console.log(
    `creating private game got difficulty: ${lobbyConfig.gameStartInfo.config.difficulty}`,
  );

  return new ClientGameRunner(
    lobbyConfig,
    clientID,
    eventBus,
    new SpaceInputHandler(eventBus),
    bridge,
    transport,
    worker,
    gameView,
  );
}

export class ClientGameRunner {
  private myPlayer: PlayerView | null = null;
  private isActive = false;

  private turnsSeen = 0;
  /** Last tile the mouse hovered over on the R3F map plane. */
  private lastHoveredTile: TileRef | null = null;

  private lastMessageTime: number = 0;
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private goToPlayerTimeout: NodeJS.Timeout | null = null;

  private lastTickReceiveTime: number = 0;
  private currentTickDelay: number | undefined = undefined;

  constructor(
    private lobby: LobbyConfig,
    private clientID: ClientID | undefined,
    private eventBus: EventBus,
    private input: SpaceInputHandler,
    private bridge: GameBridge,
    private transport: Transport,
    private worker: WorkerClient,
    private gameView: GameView,
  ) {
    this.lastMessageTime = Date.now();
  }

  /**
   * Determines whether window closing should be prevented.
   *
   * Used to show a confirmation dialog when the user attempts to close
   * the window or navigate away during an active game session.
   *
   * @returns {boolean} `true` if the window close should be prevented
   * (when the player is alive in the game), `false` otherwise
   * (when the player is not alive or doesn't exist)
   */
  public shouldPreventWindowClose(): boolean {
    // Show confirmation dialog if player is alive in the game
    return !!this.myPlayer?.isAlive();
  }

  private async saveGame(update: WinUpdate) {
    if (!this.clientID) {
      return;
    }
    const players: PlayerRecord[] = [
      {
        persistentID: getPersistentID(),
        username: this.lobby.playerName,
        clanTag: this.lobby.playerClanTag ?? null,
        clientID: this.clientID,
        stats: update.allPlayersStats[this.clientID],
      },
    ];

    if (this.lobby.gameStartInfo === undefined) {
      throw new Error("missing gameStartInfo");
    }
    const record = createPartialGameRecord(
      this.lobby.gameStartInfo.gameID,
      this.lobby.gameStartInfo.config,
      players,
      // Not saving turns locally
      [],
      startTime(),
      Date.now(),
      update.winner,
      this.lobby.gameStartInfo.lobbyCreatedAt,
      this.lobby.gameStartInfo.visibleAt,
    );
    endGame(record);
  }

  public start() {
    SoundManager.playBackgroundMusic();
    console.log("starting client game");

    this.isActive = true;
    this.lastMessageTime = Date.now();
    setTimeout(() => {
      this.connectionCheckInterval = setInterval(
        () => this.onConnectionCheck(),
        1000,
      );
    }, 20000);

    this.eventBus.on(MouseUpEvent, this.inputEvent.bind(this));
    this.eventBus.on(TileHoverEvent, this.onTileHover.bind(this));
    this.eventBus.on(TileHoverClearEvent, this.onTileHoverClear.bind(this));
    this.eventBus.on(AutoUpgradeEvent, this.autoUpgradeEvent.bind(this));
    this.eventBus.on(
      DoBoatAttackEvent,
      this.doBoatAttackUnderCursor.bind(this),
    );
    this.eventBus.on(
      DoGroundAttackEvent,
      this.doGroundAttackUnderCursor.bind(this),
    );

    this.input.initialize();

    // Wire up EventBus → HUDStore synchronisation so keyboard hotkeys
    // (ghost structure, attack ratio, rocket direction) update the store
    // before ClientGameRunner.inputEvent() reads it.
    this.bridge.initialize(this.eventBus);

    // Reset the HUD store so no stale data from a previous session leaks
    // into the new game (winner, messages, ghostStructure, etc.).
    useHUDStore.getState().reset();

    // Mount the React/R3F scene + HUD as the primary rendering path
    mountReactRoot(this.gameView, this.eventBus);

    // Hide the Lit game-starting-modal now that the React UI is taking over
    const startingModal = document.querySelector(
      "game-starting-modal",
    ) as HTMLElement | null;
    if (startingModal) {
      startingModal.classList.add("hidden");
    }
    (window as any).__gameStartingModal?.hide();

    this.worker.start((gu: GameUpdateViewData | ErrorUpdate) => {
      if (this.lobby.gameStartInfo === undefined) {
        throw new Error("missing gameStartInfo");
      }
      if ("errMsg" in gu) {
        showErrorModal(
          gu.errMsg,
          gu.stack ?? "missing",
          this.lobby.gameStartInfo.gameID,
          this.clientID,
        );
        console.error(gu.stack);
        this.stop();
        return;
      }
      this.transport.turnComplete();
      gu.updates[GameUpdateType.Hash].forEach((hu: HashUpdate) => {
        this.eventBus.emit(new SendHashEvent(hu.tick, hu.hash));
      });
      this.gameView.update(gu);

      // Sync game state into Zustand store — feeds React/R3F scene + HUD
      this.bridge.tick();

      // Fan out this tick's updates to scene renderers (WarpLaneRenderer,
      // FxRenderer). This is the authoritative per-tick scene feed — render
      // components must NOT poll updatesSinceLastTick() from useFrame, or
      // they will silently drop intermediate ticks during catch-up.
      this.eventBus.emit(new SceneTickEvent(gu.tick, gu.updates));

      // Emit tick metrics event for performance overlay
      this.eventBus.emit(
        new TickMetricsEvent(gu.tickExecutionDuration, this.currentTickDelay),
      );

      // Reset tick delay for next measurement
      this.currentTickDelay = undefined;

      if (gu.updates[GameUpdateType.Win].length > 0) {
        this.saveGame(gu.updates[GameUpdateType.Win][0]);
      }
    });

    const onconnect = () => {
      console.log("Connected to game server!");
      this.transport.rejoinGame(this.turnsSeen);
    };
    const onmessage = (message: ServerMessage) => {
      this.lastMessageTime = Date.now();
      if (message.type === "start") {
        console.log("starting game! in client game runner");

        if (this.gameView.config().isRandomSpawn()) {
          const goToPlayer = () => {
            const myPlayer = this.gameView.myPlayer();

            if (this.gameView.inSpawnPhase() && !myPlayer?.hasSpawned()) {
              this.goToPlayerTimeout = setTimeout(goToPlayer, 1000);
              return;
            }

            if (!myPlayer) {
              return;
            }

            if (!this.gameView.inSpawnPhase() && !myPlayer.hasSpawned()) {
              showErrorModal(
                "spawn_failed",
                translateText("error_modal.spawn_failed.description"),
                this.lobby.gameID,
                this.clientID,
                true,
                false,
                translateText("error_modal.spawn_failed.title"),
              );
              return;
            }

            this.eventBus.emit(new GoToPlayerEvent(myPlayer));
          };

          goToPlayer();
        }

        for (const turn of message.turns) {
          if (turn.turnNumber < this.turnsSeen) {
            continue;
          }
          while (turn.turnNumber - 1 > this.turnsSeen) {
            this.worker.sendTurn({
              turnNumber: this.turnsSeen,
              intents: [],
            });
            this.turnsSeen++;
          }
          this.worker.sendTurn(turn);
          this.turnsSeen++;
        }
      }
      if (message.type === "desync") {
        if (this.lobby.gameStartInfo === undefined) {
          throw new Error("missing gameStartInfo");
        }
        showErrorModal(
          `desync from server: ${JSON.stringify(message)}`,
          "",
          this.lobby.gameStartInfo.gameID,
          this.clientID,
          true,
          false,
          "error_modal.desync_notice",
        );
      }
      if (message.type === "error") {
        showErrorModal(
          message.error,
          message.message,
          this.lobby.gameID,
          this.clientID,
          true,
          false,
          "error_modal.connection_error",
        );
      }
      if (message.type === "turn") {
        // Track when we receive the turn to calculate delay
        const now = Date.now();
        if (this.lastTickReceiveTime > 0) {
          // Calculate delay between receiving turn messages
          this.currentTickDelay = now - this.lastTickReceiveTime;
        }
        this.lastTickReceiveTime = now;

        if (this.turnsSeen !== message.turn.turnNumber) {
          console.error(
            `got wrong turn have turns ${this.turnsSeen}, received turn ${message.turn.turnNumber}`,
          );
        } else {
          this.worker.sendTurn(
            // Filter out pause intents in replays
            this.gameView.config().isReplay()
              ? {
                  ...message.turn,
                  intents: message.turn.intents.filter(
                    (i) => i.type !== "toggle_pause",
                  ),
                }
              : message.turn,
          );
          this.turnsSeen++;
        }
      }
    };
    this.transport.updateCallback(onconnect, onmessage);
    console.log("sending join game");
    // Rejoin game from the start so we don't miss any turns.
    this.transport.rejoinGame(0);
  }

  public stop() {
    SoundManager.stopBackgroundMusic();
    if (!this.isActive) return;

    this.isActive = false;
    this.input.destroy();
    this.bridge.destroy();
    unmountReactRoot();
    // Clear all session-scoped HUD data so nothing leaks into the next game.
    useHUDStore.getState().reset();
    this.worker.cleanup();
    this.transport.leaveGame();
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    if (this.goToPlayerTimeout) {
      clearTimeout(this.goToPlayerTimeout);
      this.goToPlayerTimeout = null;
    }
  }

  /**
   * Handle a left-click on the map.
   *
   * The R3F SpaceMapPlane emits tile coordinates directly.
   */
  private inputEvent(event: MouseUpEvent) {
    if (!this.isActive) {
      return;
    }

    const tileX = event.x;
    const tileY = event.y;

    if (!this.gameView.isValidCoord(tileX, tileY)) {
      return;
    }
    const tile = this.gameView.ref(tileX, tileY);

    // Update selectedTile in HUD store for React consumers
    this.bridge.setSelectedTile(tile);

    // Ghost placement flow: if the user selected a structure via the build
    // hotkeys (SpaceInputHandler.resolveBuildKeybind → GhostStructureChangedEvent),
    // a subsequent click on the map should commit the build by emitting the
    // correct intent. Mirror BuildMenu.sendBuildOrUpgrade: resolve buildables
    // for this tile, find the matching unit type, then emit
    // SendUpgradeStructureIntentEvent when canUpgrade is available, or
    // BuildUnitIntentEvent when canBuild is valid.
    const ghostStructure = useHUDStore.getState().ghostStructure;
    if (ghostStructure !== null) {
      if (this.gameView.inSpawnPhase()) {
        return;
      }
      if (this.myPlayer === null) {
        if (!this.clientID) return;
        const myPlayer = this.gameView.playerByClientID(this.clientID);
        if (myPlayer === null) return;
        this.myPlayer = myPlayer;
      }
      this.myPlayer.buildables(tile, BuildMenus.types).then((buildables) => {
        const buildableUnit = buildables.find(
          (bu) => bu.type === ghostStructure,
        );
        if (!buildableUnit) return;
        if (buildableUnit.canUpgrade !== false) {
          this.eventBus.emit(
            new SendUpgradeStructureIntentEvent(
              buildableUnit.canUpgrade,
              buildableUnit.type,
            ),
          );
        } else if (buildableUnit.canBuild) {
          const rocketDirectionUp =
            ghostStructure === UnitType.AtomBomb ||
            ghostStructure === UnitType.HydrogenBomb
              ? useHUDStore.getState().rocketDirectionUp
              : undefined;
          this.eventBus.emit(
            new BuildUnitIntentEvent(ghostStructure, tile, rocketDirectionUp),
          );
        }
        // Clear the ghost after a placement so the next click returns to
        // normal click behaviour (attack / open panel) instead of building
        // the same structure repeatedly. Matches the legacy onContextMenu
        // flow in InputHandler.setGhostStructure(null).
        this.eventBus.emit(new GhostStructureChangedEvent(null));
      });
      return;
    }

    if (
      this.gameView.isLand(tile) &&
      !this.gameView.hasOwner(tile) &&
      this.gameView.inSpawnPhase() &&
      !this.gameView.config().isRandomSpawn()
    ) {
      this.eventBus.emit(new SendSpawnIntentEvent(tile));
      return;
    }
    if (this.gameView.inSpawnPhase()) {
      return;
    }
    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }
    // Fetch the full action set (null = all structures) so that we can
    // both decide attack/boat behaviour and pass a valid PlayerActions
    // payload to the PlayerPanel when no attack is possible.
    this.myPlayer.actions(tile, null).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.bridge.attackRatio,
          ),
        );
        return;
      }
      if (this.canAutoBoat(actions.buildableUnits, tile)) {
        this.sendBoatAttackIntent(tile);
        return;
      }
      // No attack / boat path available — if the tile is owned by a player
      // (self or other), open the PlayerPanel so alliance / embargo / target
      // / chat actions remain reachable. This is the direct R3F-path trigger
      // for ShowPlayerPanelEvent, replacing the legacy layer flow.
      const owner = this.gameView.owner(tile);
      if (owner.isPlayer()) {
        this.eventBus.emit(new ShowPlayerPanelEvent(actions, tile));
      }
    });
  }

  /**
   * Handle middle-click auto-upgrade.
   *
   * The R3F SpaceMapPlane emits tile coordinates directly.
   */
  private autoUpgradeEvent(event: AutoUpgradeEvent) {
    if (!this.isActive) {
      return;
    }

    const tileX = event.x;
    const tileY = event.y;

    if (!this.gameView.isValidCoord(tileX, tileY)) {
      return;
    }
    const tile = this.gameView.ref(tileX, tileY);
    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }
    if (this.gameView.inSpawnPhase()) {
      return;
    }
    this.findAndUpgradeNearestBuilding(tile);
  }

  private findAndUpgradeNearestBuilding(clickedTile: TileRef) {
    this.myPlayer!.actions(clickedTile, Structures.types).then((actions) => {
      const upgradeUnits: {
        unitId: number;
        unitType: UnitType;
        distance: number;
      }[] = [];

      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade !== false) {
          const existingUnit = this.gameView
            .units()
            .find((unit) => unit.id() === bu.canUpgrade);
          if (existingUnit) {
            const distance = this.gameView.manhattanDist(
              clickedTile,
              existingUnit.tile(),
            );

            upgradeUnits.push({
              unitId: bu.canUpgrade,
              unitType: bu.type,
              distance: distance,
            });
          }
        }
      }

      if (upgradeUnits.length > 0) {
        const bestUpgrade = findClosestBy(upgradeUnits, (u) => u.distance);
        if (bestUpgrade) {
          this.eventBus.emit(
            new SendUpgradeStructureIntentEvent(
              bestUpgrade.unitId,
              bestUpgrade.unitType,
            ),
          );
        }
      }
    });
  }

  private doBoatAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer
      .buildables(tile, [UnitType.TransportShip])
      .then((buildables) => {
        if (this.canBoatAttack(buildables) !== false) {
          this.sendBoatAttackIntent(tile);
        } else {
          console.warn(
            "Boat attack triggered but can't send Transport Ship to tile",
          );
        }
      });
  }

  private doGroundAttackUnderCursor(): void {
    const tile = this.getTileUnderCursor();
    if (tile === null) {
      return;
    }

    if (this.myPlayer === null) {
      if (!this.clientID) return;
      const myPlayer = this.gameView.playerByClientID(this.clientID);
      if (myPlayer === null) return;
      this.myPlayer = myPlayer;
    }

    this.myPlayer.actions(tile, null).then((actions) => {
      if (actions.canAttack) {
        this.eventBus.emit(
          new SendAttackIntentEvent(
            this.gameView.owner(tile).id(),
            this.myPlayer!.troops() * this.bridge.attackRatio,
          ),
        );
      }
    });
  }

  private getTileUnderCursor(): TileRef | null {
    if (!this.isActive) {
      return null;
    }
    if (this.gameView.inSpawnPhase()) {
      return null;
    }
    // R3F pointer events supply the hovered tile directly — but only while
    // the pointer is actually over the map. TileHoverClearEvent resets
    // lastHoveredTile to null on pointer-out so boat/ground-attack hotkeys
    // do not fire on whatever tile the cursor last grazed.
    if (this.lastHoveredTile !== null) {
      return this.lastHoveredTile;
    }
    return null;
  }

  private canBoatAttack(buildables: BuildableUnit[]): false | TileRef {
    const bu = buildables.find((bu) => bu.type === UnitType.TransportShip);
    return bu?.canBuild ?? false;
  }

  private sendBoatAttackIntent(tile: TileRef) {
    if (!this.myPlayer) return;

    this.eventBus.emit(
      new SendBoatAttackIntentEvent(
        tile,
        this.myPlayer.troops() * this.bridge.attackRatio,
      ),
    );
  }

  private canAutoBoat(buildables: BuildableUnit[], tile: TileRef): boolean {
    if (!this.gameView.isLand(tile)) return false;

    const canBuild = this.canBoatAttack(buildables);
    if (canBuild === false) return false;

    const distanceSquared = this.gameView.euclideanDistSquared(tile, canBuild);
    const limit = 100;
    const limitSquared = limit * limit;
    return distanceSquared < limitSquared;
  }

  private onTileHover(event: TileHoverEvent) {
    if (!this.gameView.isValidCoord(event.tileX, event.tileY)) {
      return;
    }
    this.lastHoveredTile = this.gameView.ref(event.tileX, event.tileY);
  }

  private onTileHoverClear() {
    // Pointer left the map — drop the cached hover tile so subsequent
    // boat/ground-attack hotkeys fall through to no-op rather than
    // targeting a stale tile.
    this.lastHoveredTile = null;
  }

  private onConnectionCheck() {
    if (this.transport.isLocal) {
      return;
    }
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (timeSinceLastMessage > 5000) {
      console.log(
        `No message from server for ${timeSinceLastMessage} ms, reconnecting`,
      );
      this.lastMessageTime = now;
      this.transport.reconnect();
    }
  }
}

function showErrorModal(
  error: string,
  message: string | undefined,
  gameID: GameID,
  clientID: ClientID | undefined,
  closable = false,
  showDiscord = true,
  heading = "error_modal.crashed",
) {
  if (document.querySelector("#error-modal")) {
    return;
  }

  const translatedError = translateText(error);
  const displayError = translatedError === error ? error : translatedError;

  const modal = document.createElement("div");
  modal.id = "error-modal";

  const content = [
    showDiscord ? translateText("error_modal.paste_discord") : null,
    translateText(heading),
    `game id: ${gameID}`,
    `client id: ${clientID}`,
    `Error: ${displayError}`,
    message ? `Message: ${message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Create elements
  const pre = document.createElement("pre");
  pre.textContent = content;

  const button = document.createElement("button");
  button.textContent = translateText("error_modal.copy_clipboard");
  button.className = "copy-btn";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content);
      button.textContent = translateText("error_modal.copied");
    } catch {
      button.textContent = translateText("error_modal.failed_copy");
    }
  });

  // Add to modal
  modal.appendChild(pre);
  modal.appendChild(button);
  if (closable) {
    const closeButton = document.createElement("button");
    closeButton.textContent = "X";
    closeButton.className = "close-btn";
    closeButton.addEventListener("click", () => {
      modal.remove();
    });
    modal.appendChild(closeButton);
  }

  document.body.appendChild(modal);
}
