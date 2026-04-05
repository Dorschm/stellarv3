import { PlayerID } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView } from "../../core/game/GameView";
import {
  MessageSnapshot,
  PlayerSnapshot,
  UnitSnapshot,
  useHUDStore,
} from "./HUDStore";

/**
 * GameBridge synchronises the imperative GameView state into the Zustand
 * HUDStore every game tick.  It is the single authoritative bridge — there
 * is no duplicate React-component bridge.  Called from ClientGameRunner
 * after each tick.
 *
 * Usage (imperative — called from ClientGameRunner):
 *   const bridge = new GameBridge(gameView, clientID);
 *   bridge.tick();  // called each tick instead of renderer.tick()
 */
export class GameBridge {
  private _msgIdCounter = 0;

  constructor(
    private gameView: GameView,
    private clientID: string | undefined,
  ) {}

  /** Push a snapshot of current GameView state into the Zustand store. */
  tick(): void {
    const store = useHUDStore.getState();

    // -- Game clock --
    const tick = this.gameView.ticks();
    store.setTick(tick);

    // -- Spawn phase --
    store.setInSpawnPhase(this.gameView.inSpawnPhase());

    // -- Players --
    const playerMap = new Map<PlayerID, PlayerSnapshot>();
    const myPlayer = this.gameView.myPlayer();
    let mySnap: PlayerSnapshot | null = null;

    for (const p of this.gameView.players()) {
      const isMe = myPlayer !== null ? p.id() === myPlayer.id() : false;
      const snap: PlayerSnapshot = {
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
      playerMap.set(snap.id, snap);
      if (isMe) {
        mySnap = snap;
      }
    }
    store.setPlayers(playerMap);
    store.setMyPlayer(mySnap);

    // -- Units --
    const unitMap = new Map<number, UnitSnapshot>();
    for (const u of this.gameView.units()) {
      unitMap.set(u.id(), {
        id: u.id(),
        type: u.type(),
        ownerSmallID: u.owner().smallID(),
        tile: u.tile(),
        troops: u.troops(),
        level: u.level(),
        isActive: u.isActive(),
        health: u.hasHealth() ? u.health() : undefined,
      });
    }
    store.setUnits(unitMap);

    // -- Updates since last tick (winner, display messages) --
    const updates = this.gameView.updatesSinceLastTick();
    if (updates !== null) {
      // Winner
      const winUpdates = updates[GameUpdateType.Win];
      if (winUpdates && winUpdates.length > 0) {
        store.setWinner(winUpdates[0]);
      }

      // Display messages
      const displayUpdates = updates[GameUpdateType.DisplayEvent];
      if (displayUpdates && displayUpdates.length > 0) {
        const newMessages: MessageSnapshot[] = displayUpdates.map((u) => ({
          id: this._msgIdCounter++,
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

  /**
   * Read attackRatio as a normalized 0..1 multiplier (replaces renderer.uiState.attackRatio).
   *
   * The HUDStore stores the ratio as a percent integer (0..100) to match the
   * ControlPanel slider's native range. Consumers that need to multiply by a
   * troop count (e.g. SendAttackIntentEvent, SendBoatAttackIntentEvent) want a
   * normalized 0..1 value, so convert here. The store value is clamped to
   * [0, 100] before normalizing to guard against out-of-range writes.
   */
  get attackRatio(): number {
    const percent = useHUDStore.getState().attackRatio;
    const clamped = Math.max(0, Math.min(100, percent));
    return clamped / 100;
  }

  /** Update the selected tile in the HUD store (called on click / context interactions). */
  setSelectedTile(tile: TileRef | null): void {
    useHUDStore.getState().setSelectedTile(tile);
  }
}
