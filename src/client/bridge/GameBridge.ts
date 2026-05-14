import { EventBus } from "../../core/EventBus";
import {
  Credits,
  Player,
  PlayerID,
  PlayerType,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../core/game/GameView";
import {
  AttackRatioEvent,
  GhostStructureChangedEvent,
  SwapRocketDirectionEvent,
} from "../InputHandler";
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
  private eventBus: EventBus | null = null;

  constructor(
    private gameView: GameView,
    private clientID: string | undefined,
  ) {}

  // -------------------------------------------------------------------
  // EventBus → HUDStore synchronisation
  // -------------------------------------------------------------------

  /**
   * Subscribe to input-owned EventBus events and keep the HUDStore in sync.
   * Must be called once after construction (before the first tick).
   */
  initialize(eventBus: EventBus): void {
    this.eventBus = eventBus;
    eventBus.on(GhostStructureChangedEvent, this.onGhostStructureChanged);
    eventBus.on(AttackRatioEvent, this.onAttackRatioChanged);
    eventBus.on(SwapRocketDirectionEvent, this.onSwapRocketDirection);
  }

  /** Unsubscribe from the EventBus. Safe to call multiple times. */
  destroy(): void {
    if (this.eventBus) {
      this.eventBus.off(
        GhostStructureChangedEvent,
        this.onGhostStructureChanged,
      );
      this.eventBus.off(AttackRatioEvent, this.onAttackRatioChanged);
      this.eventBus.off(SwapRocketDirectionEvent, this.onSwapRocketDirection);
      this.eventBus = null;
    }
  }

  private onGhostStructureChanged = (e: GhostStructureChangedEvent): void => {
    useHUDStore.getState().setGhostStructure(e.ghostStructure);
  };

  private onAttackRatioChanged = (e: AttackRatioEvent): void => {
    const state = useHUDStore.getState();
    const newRatio = Math.max(
      0,
      Math.min(100, state.attackRatio + e.attackRatio),
    );
    state.setAttackRatio(newRatio);
  };

  private onSwapRocketDirection = (e: SwapRocketDirectionEvent): void => {
    useHUDStore.getState().setRocketDirectionUp(e.rocketDirectionUp);
  };

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
        population: p.population(),
        credits: p.credits(),
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
        population: u.population(),
        level: u.level(),
        isActive: u.isActive(),
        health: u.hasHealth() ? u.health() : undefined,
        hasSlottedStructure: u.hasSlottedStructure(),
      });
    }
    store.setUnits(unitMap);

    // -- Hostable structure costs (issue #7) --
    // Snapshot the per-tick cost of every Battlecruiser-hostable structure
    // for the local player so SpaceInputHandler can show a "Not enough
    // money" toast immediately when a selected-cruiser hotkey is pressed
    // without funds, instead of the host-only intent silently bouncing on
    // the server. The cost function is invoked with a PlayerView-backed
    // adapter implementing the narrow Player subset DefaultConfig.costWrapper
    // actually reads (`type`, `unitsOwned`, `unitsConstructed`); we no longer
    // smuggle a PlayerView through `as any`, and any throw from the cost
    // function now propagates instead of being silently swallowed.
    const costMap = new Map<UnitType, Credits>();
    if (myPlayer !== null) {
      const adapter = adaptPlayerForCost(myPlayer);
      const hostable = this.gameView.config().battlecruiserHostableStructures();
      for (const t of hostable) {
        const fn = this.gameView.unitInfo(t).cost as unknown as (
          g: GameView,
          p: CostFnPlayerLike,
        ) => Credits;
        costMap.set(t, fn(this.gameView, adapter));
      }
    }
    store.setCruiserHostableCosts(costMap);

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
          creditAmount: u.creditAmount,
          playerID: u.playerID,
          tick,
          params: u.params,
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
   * population count (e.g. SendAttackIntentEvent, SendShuttleAttackIntentEvent) want a
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

// ---------------------------------------------------------------------------
// Cost-function PlayerView adapter (issue #7)
// ---------------------------------------------------------------------------

/**
 * The narrow subset of `Player` that `DefaultConfig.costWrapper` actually
 * reads. Hostable-structure costs (Spaceport, Foundry, Colony, DefenseStation,
 * OrbitalStrikePlatform, PointDefenseArray, JumpGate) all flow through
 * `costWrapper`, so this is the full structural contract for those types.
 */
type CostFnPlayerLike = Pick<
  Player,
  "type" | "unitsOwned" | "unitsConstructed"
>;

/**
 * Build a `CostFnPlayerLike` view of a `PlayerView`. Mirrors `PlayerImpl`'s
 * `unitsOwned` / `unitsConstructed` shape using the unit data the client
 * already has.
 *
 * Note on parity: `PlayerImpl.unitsConstructed` includes a server-side
 * "ever built" counter (`numUnitsConstructed[type]`) that is not part of
 * `PlayerView`. The client therefore counts only currently-extant units,
 * which can under-estimate cost when the player has destroyed structures of
 * the same type. The Math.min() inside `costWrapper` clamps to whichever
 * counter is lower, so the worst case is the toast failing to fire and the
 * server falling back to its existing silent rejection — never a false
 * positive that blocks a legitimate build.
 */
function adaptPlayerForCost(player: PlayerView): CostFnPlayerLike {
  return {
    type: (): PlayerType => player.type(),
    unitsOwned: (type: UnitType): number => {
      let total = 0;
      for (const u of player.units(type)) {
        total += u.isUnderConstruction() ? 1 : u.level();
      }
      return total;
    },
    unitsConstructed: (type: UnitType): number => {
      return player.units(type).length;
    },
  };
}
