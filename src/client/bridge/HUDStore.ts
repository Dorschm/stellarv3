import { create } from "zustand";
import {
  Gold,
  MessageType,
  PlayerID,
  PlayerType,
  Team,
  Tick,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { WinUpdate } from "../../core/game/GameUpdates";

// ---------------------------------------------------------------------------
// Lightweight snapshot types — plain data only, no class instances.
// These are what the React/R3F layer consumes via selectors.
// ---------------------------------------------------------------------------

/** Minimal player snapshot written every tick. */
export interface PlayerSnapshot {
  id: PlayerID;
  smallID: number;
  name: string;
  displayName: string;
  isAlive: boolean;
  troops: number;
  gold: Gold;
  numTilesOwned: number;
  allies: number[];
  isMe: boolean;
  playerType: PlayerType;
  team: Team | null;
}

/** Minimal unit snapshot written every tick. */
export interface UnitSnapshot {
  id: number;
  type: UnitType;
  ownerSmallID: number;
  tile: TileRef;
  troops: number;
  level: number;
  isActive: boolean;
  health: number | undefined;
}

/** Lightweight game message for the EventsDisplay / ChatDisplay. */
export interface MessageSnapshot {
  id: number;
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  tick: Tick;
  params?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface HUDState {
  // -- Game clock --
  ticks: Tick;

  // -- Players --
  /** The local player's snapshot, or `null` if spectating / not yet spawned. */
  myPlayer: PlayerSnapshot | null;
  /** All players keyed by PlayerID. */
  players: Map<PlayerID, PlayerSnapshot>;

  // -- Units --
  /** All active units keyed by unit id. */
  units: Map<number, UnitSnapshot>;

  // -- UI interaction --
  /** Currently selected tile (for context menus, build UI, etc.). */
  selectedTile: TileRef | null;
  /** Troop-split slider ratio (0–100). */
  attackRatio: number;
  /** Currently selected ghost structure for placement. */
  ghostStructure: UnitType | null;
  /** Rocket/missile launch direction (true = up, false = down). */
  rocketDirectionUp: boolean;

  // -- Game phase --
  /** Whether the game is in the spawn phase (before main play begins). */
  inSpawnPhase: boolean;
  /** The win update when the game ends, null while game is ongoing. */
  winner: WinUpdate | null;
  /** Recent display messages (accumulated, capped at 50). */
  messages: MessageSnapshot[];

  // -- Setters (called by GameBridge on each tick) --
  setTick: (tick: Tick) => void;
  setMyPlayer: (player: PlayerSnapshot | null) => void;
  setPlayers: (players: Map<PlayerID, PlayerSnapshot>) => void;
  setUnits: (units: Map<number, UnitSnapshot>) => void;
  setSelectedTile: (tile: TileRef | null) => void;
  setAttackRatio: (ratio: number) => void;
  setGhostStructure: (gs: UnitType | null) => void;
  setRocketDirectionUp: (up: boolean) => void;
  setInSpawnPhase: (inSpawnPhase: boolean) => void;
  setWinner: (winner: WinUpdate | null) => void;
  addMessages: (newMessages: MessageSnapshot[]) => void;

  /** Reset all slices to initial defaults. Call between game sessions. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 50;

/** Initial default values for every data slice. */
const INITIAL_STATE = {
  ticks: 0 as Tick,
  myPlayer: null as PlayerSnapshot | null,
  players: new Map<PlayerID, PlayerSnapshot>(),
  units: new Map<number, UnitSnapshot>(),
  selectedTile: null as TileRef | null,
  attackRatio: 20,
  ghostStructure: null as UnitType | null,
  rocketDirectionUp: true,
  inSpawnPhase: false,
  winner: null as WinUpdate | null,
  messages: [] as MessageSnapshot[],
};

export const useHUDStore = create<HUDState>((set) => ({
  // -- defaults --
  ...INITIAL_STATE,

  // -- setters --
  setTick: (tick) => set({ ticks: tick }),
  setMyPlayer: (player) => set({ myPlayer: player }),
  setPlayers: (players) => set({ players }),
  setUnits: (units) => set({ units }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
  setAttackRatio: (ratio) => set({ attackRatio: ratio }),
  setGhostStructure: (gs) => set({ ghostStructure: gs }),
  setRocketDirectionUp: (up) => set({ rocketDirectionUp: up }),
  setInSpawnPhase: (inSpawnPhase) => set({ inSpawnPhase }),
  setWinner: (winner) => set({ winner }),
  addMessages: (newMessages) =>
    set((state) => ({
      messages: [...state.messages, ...newMessages].slice(-MAX_MESSAGES),
    })),
  reset: () =>
    set({
      ...INITIAL_STATE,
      // Fresh collection instances so stale references from the previous
      // session cannot leak through.
      players: new Map(),
      units: new Map(),
      messages: [],
    }),
}));
