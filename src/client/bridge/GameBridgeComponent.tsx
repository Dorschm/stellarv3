import { useCallback, useEffect, useRef } from "react";
import { PlayerID } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../core/game/GameView";
import {
  AttackRatioEvent,
  GhostStructureChangedEvent,
  TickMetricsEvent,
} from "../InputHandler";
import { useGameView } from "./GameViewContext";
import {
  MessageSnapshot,
  PlayerSnapshot,
  UnitSnapshot,
  useHUDStore,
} from "./HUDStore";
import { useEventBus } from "./useEventBus";

// ---------------------------------------------------------------------------
// Helpers — convert GameView class instances to plain snapshot objects
// ---------------------------------------------------------------------------

function snapshotPlayer(p: PlayerView, isMe: boolean): PlayerSnapshot {
  return {
    id: p.id(),
    smallID: p.smallID(),
    name: p.name(),
    displayName: p.displayName(),
    isAlive: p.isAlive(),
    troops: p.troops(),
    gold: p.gold(),
    numTilesOwned: p.numTilesOwned(),
    allies: p.allies().map((a) => a.smallID()),
    isMe,
    playerType: p.type(),
    team: p.team(),
  };
}

let _msgIdCounter = 0;

function syncStoreFromGameView(gameView: GameView): void {
  const store = useHUDStore.getState();

  // -- tick --
  const tick = gameView.ticks();
  store.setTick(tick);

  // -- spawn phase --
  store.setInSpawnPhase(gameView.inSpawnPhase());

  // -- players --
  const myPlayer = gameView.myPlayer();
  const playersMap = new Map<PlayerID, PlayerSnapshot>();
  for (const p of gameView.players()) {
    const isMe = myPlayer !== null && p.id() === myPlayer.id();
    playersMap.set(p.id(), snapshotPlayer(p, isMe));
  }
  store.setPlayers(playersMap);

  // -- my player --
  if (myPlayer !== null) {
    store.setMyPlayer(playersMap.get(myPlayer.id()) ?? null);
  } else {
    store.setMyPlayer(null);
  }

  // -- units --
  const unitsMap = new Map<number, UnitSnapshot>();
  for (const u of gameView.units()) {
    unitsMap.set(u.id(), {
      id: u.id(),
      type: u.type(),
      ownerSmallID: u.owner().smallID(),
      tile: u.tile(),
      troops: u.troops(),
      level: u.level(),
      isActive: u.isActive(),
      health: u.health(),
    });
  }
  store.setUnits(unitsMap);

  // -- updates since last tick --
  const updates = gameView.updatesSinceLastTick();
  if (updates !== null) {
    // winner
    const winUpdates = updates[GameUpdateType.Win];
    if (winUpdates && winUpdates.length > 0) {
      store.setWinner(winUpdates[0]);
    }

    // display messages
    const displayUpdates = updates[GameUpdateType.DisplayEvent];
    if (displayUpdates && displayUpdates.length > 0) {
      const newMessages: MessageSnapshot[] = displayUpdates.map((u) => ({
        id: _msgIdCounter++,
        message: u.message,
        messageType: u.messageType,
        goldAmount: u.goldAmount,
        playerID: u.playerID,
        tick,
      }));
      store.addMessages(newMessages);
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Invisible React component that bridges the legacy game tick cycle into the
 * Zustand {@link useHUDStore}.
 *
 * It listens for {@link TickMetricsEvent} on the shared {@link EventBus}
 * (emitted by `ClientGameRunner` after every tick) and snapshots the current
 * `GameView` state into the store so that React/R3F consumers can read it
 * via selectors without touching class instances.
 *
 * Renders nothing — this is a pure side-effect bridge.
 */
export function GameBridge(): null {
  const { gameView, eventBus } = useGameView();
  const initialised = useRef(false);

  // Run an initial sync so the store is populated before the first tick fires.
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;
      syncStoreFromGameView(gameView);
      console.log("[GameBridge] initial sync complete");
    }
  }, [gameView]);

  // On every game tick, re-snapshot the GameView into the store.
  const onTick = useCallback(() => {
    syncStoreFromGameView(gameView);
  }, [gameView]);

  useEventBus(eventBus, TickMetricsEvent, onTick);

  // Sync ghost structure changes into the store
  const onGhostStructureChanged = useCallback(
    (e: GhostStructureChangedEvent) => {
      useHUDStore.getState().setGhostStructure(e.ghostStructure);
    },
    [],
  );
  useEventBus(eventBus, GhostStructureChangedEvent, onGhostStructureChanged);

  // Sync attack ratio changes into the store
  const onAttackRatioChanged = useCallback((e: AttackRatioEvent) => {
    const state = useHUDStore.getState();
    const newRatio = Math.max(0, Math.min(100, state.attackRatio + e.attackRatio));
    state.setAttackRatio(newRatio);
  }, []);
  useEventBus(eventBus, AttackRatioEvent, onAttackRatioChanged);

  // Log mount once (via the initialised ref to avoid repeat logs).
  useEffect(() => {
    console.log("[GameBridge] mounted — listening for ticks");
  }, []);

  return null;
}
