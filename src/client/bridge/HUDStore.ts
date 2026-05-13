import { create } from "zustand";
import {
  Credits,
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
  population: number;
  credits: Credits;
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
  population: number;
  level: number;
  isActive: boolean;
  health: number | undefined;
  /**
   * Issue #7 — `true` when this unit is a Battlecruiser whose one-slot
   * structure mount is currently occupied. Surfaced so the hotkey path can
   * render immediate "slot occupied" feedback. Always `false` for non-
   * Battlecruiser units.
   */
  hasSlottedStructure: boolean;
}

/** Lightweight game message for the EventsDisplay / ChatDisplay. */
export interface MessageSnapshot {
  id: number;
  message: string;
  messageType: MessageType;
  creditAmount?: bigint;
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

  /**
   * Issue #7 — per-tick cost snapshot for the local player of every
   * Battlecruiser-hostable structure type. Lets the selected-cruiser hotkey
   * path in `SpaceInputHandler` give immediate "Not enough money" feedback
   * before sending an intent the server would silently reject. Empty when
   * spectating or before the first player snapshot.
   */
  cruiserHostableCosts: Map<UnitType, Credits>;

  // -- UI interaction --
  /** Currently selected tile (for context menus, build UI, etc.). */
  selectedTile: TileRef | null;
  /** Population-split slider ratio (0–100). */
  attackRatio: number;
  /** Currently selected ghost structure for placement. */
  ghostStructure: UnitType | null;
  /** Rocket/missile launch direction (true = up, false = down). */
  rocketDirectionUp: boolean;

  // -- Jump Gate selection mode --
  /** Current gate selection phase. */
  jumpGateMode: "idle" | "selectSource" | "selectDest";
  /** The source gate tile after first click in gate selection mode. */
  jumpGateSourceTile: TileRef | null;

  // -- Capital Ship selection (issue #4) --
  /**
   * Unit id of the currently selected friendly Battlecruiser, or `null` if
   * none. While set, left-clicks on the map issue a move order; number-key
   * builds (1–0) auto-host on this cruiser; the cursor swaps to a
   * move-target reticle.
   */
  selectedBattlecruiserUnitId: number | null;

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
  setCruiserHostableCosts: (costs: Map<UnitType, Credits>) => void;
  setSelectedTile: (tile: TileRef | null) => void;
  setAttackRatio: (ratio: number) => void;
  setGhostStructure: (gs: UnitType | null) => void;
  setRocketDirectionUp: (up: boolean) => void;
  setJumpGateMode: (mode: "idle" | "selectSource" | "selectDest") => void;
  setJumpGateSourceTile: (tile: TileRef | null) => void;
  setSelectedBattlecruiser: (unitId: number | null) => void;
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
  cruiserHostableCosts: new Map<UnitType, Credits>(),
  selectedTile: null as TileRef | null,
  attackRatio: 20,
  ghostStructure: null as UnitType | null,
  rocketDirectionUp: true,
  jumpGateMode: "idle" as "idle" | "selectSource" | "selectDest",
  jumpGateSourceTile: null as TileRef | null,
  selectedBattlecruiserUnitId: null as number | null,
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
  setCruiserHostableCosts: (costs) => set({ cruiserHostableCosts: costs }),
  setSelectedTile: (tile) => set({ selectedTile: tile }),
  setAttackRatio: (ratio) => set({ attackRatio: ratio }),
  setGhostStructure: (gs) => set({ ghostStructure: gs }),
  setRocketDirectionUp: (up) => set({ rocketDirectionUp: up }),
  setJumpGateMode: (mode) => set({ jumpGateMode: mode }),
  setJumpGateSourceTile: (tile) => set({ jumpGateSourceTile: tile }),
  setSelectedBattlecruiser: (unitId) =>
    set({ selectedBattlecruiserUnitId: unitId }),
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
      cruiserHostableCosts: new Map(),
      messages: [],
    }),
}));
