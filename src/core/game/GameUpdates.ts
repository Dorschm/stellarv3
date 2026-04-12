import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import {
  Credits,
  EmojiMessage,
  FrigateType,
  GameUpdates,
  MessageType,
  NameViewData,
  PlayerID,
  PlayerType,
  RunScore,
  Team,
  Tick,
  UnitType,
} from "./Game";
import { TileRef } from "./GameMap";

export interface GameUpdateViewData {
  tick: number;
  updates: GameUpdates;
  /**
   * Packed tile updates as `[tileRef, state]` uint32 pairs.
   *
   * `tileRef` is a `TileRef` (fits in uint32), and `state` is the packed per-tile
   * state (`uint16`) stored in a `uint32` lane.
   */
  packedTileUpdates: Uint32Array;
  /**
   * Packed terrain updates as `[tileRef, terrainType]` uint32 pairs.
   *
   * Terrain lives in a separate backing buffer from per-tile state (see
   * `GameMap.setTerrainType` — it writes magnitude bits, not state bits),
   * so runtime terrain mutations like Scout Swarm terraforming are not
   * captured by `packedTileUpdates`. This channel carries the enum value
   * of the new `TerrainType` so clients can call `setTerrainType` and keep
   * their local `GameMap` (and any derived UI like habitability overlays)
   * coherent with the server.
   *
   * Empty in the common case — only populated on ticks where a terrain
   * mutation actually happened.
   */
  packedTerrainUpdates: Uint32Array;
  /**
   * Optional packed motion plan records.
   *
   * When present, this buffer is expected to be transferred worker -> main
   * (similar to `packedTileUpdates`) to avoid structured-clone copies.
   */
  packedMotionPlans?: Uint32Array;
  playerNameViewData: Record<string, NameViewData>;
  tickExecutionDuration?: number;
  pendingTurns?: number;
  /** GDD §10 — current dynamic tick interval for tick-rate scaling. */
  currentTurnIntervalMs?: number;
}

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export enum GameUpdateType {
  // Tile updates are delivered via `packedTileUpdates` on the outer GameUpdateViewData.
  Tile,
  Unit,
  Player,
  DisplayEvent,
  DisplayChatEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  AllianceExtension,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
  UnitIncoming,
  BonusEvent,
  HyperspaceLaneDestructionEvent,
  HyperspaceLaneConstructionEvent,
  HyperspaceLaneSnapEvent,
  ConquestEvent,
  EmbargoEvent,
  GamePaused,
  PeaceVote,
}

export type GameUpdate =
  | UnitUpdate
  | PlayerUpdate
  | AllianceRequestUpdate
  | AllianceRequestReplyUpdate
  | BrokeAllianceUpdate
  | AllianceExpiredUpdate
  | DisplayMessageUpdate
  | DisplayChatMessageUpdate
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate
  | UnitIncomingUpdate
  | AllianceExtensionUpdate
  | BonusEventUpdate
  | HyperspaceLaneConstructionUpdate
  | HyperspaceLaneDestructionUpdate
  | HyperspaceLaneSnapUpdate
  | ConquestUpdate
  | EmbargoUpdate
  | GamePausedUpdate
  | PeaceVoteUpdate;

export interface BonusEventUpdate {
  type: GameUpdateType.BonusEvent;
  player: PlayerID;
  tile: TileRef;
  credits: number;
  population: number;
}

export interface HyperspaceLaneConstructionUpdate {
  type: GameUpdateType.HyperspaceLaneConstructionEvent;
  id: number;
  tiles: TileRef[];
}

export interface HyperspaceLaneDestructionUpdate {
  type: GameUpdateType.HyperspaceLaneDestructionEvent;
  id: number;
}

export interface HyperspaceLaneSnapUpdate {
  type: GameUpdateType.HyperspaceLaneSnapEvent;
  originalId: number;
  newId1: number;
  newId2: number;
  tiles1: TileRef[];
  tiles2: TileRef[];
}

export interface ConquestUpdate {
  type: GameUpdateType.ConquestEvent;
  conquerorId: PlayerID;
  conqueredId: PlayerID;
  credits: Credits;
}

export interface UnitUpdate {
  type: GameUpdateType.Unit;
  unitType: UnitType;
  population: number;
  id: number;
  ownerID: number;
  lastOwnerID?: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  reachedTarget: boolean;
  retreating: boolean;
  targetable: boolean;
  markedForDeletion: number | false;
  targetUnitId?: number; // Only for trade freighters
  targetTile?: TileRef; // Only for nukes
  health?: number;
  underConstruction?: boolean;
  missileTimerQueue: number[];
  level: number;
  hasTradeHub: boolean;
  frigateType?: FrigateType; // Only for frigates
  loaded?: boolean; // Only for frigates
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  population: number;
  id: string;
  retreating: boolean;
}

export interface PlayerUpdate {
  type: GameUpdateType.Player;
  nameViewData?: NameViewData;
  clientID: ClientID | null;
  name: string;
  displayName: string;
  id: PlayerID;
  team?: Team;
  smallID: number;
  playerType: PlayerType;
  isAlive: boolean;
  isDisconnected: boolean;
  tilesOwned: number;
  credits: Credits;
  population: number;
  allies: number[];
  embargoes: Set<PlayerID>;
  isTraitor: boolean;
  traitorRemainingTicks?: number;
  targets: number[];
  outgoingEmojis: EmojiMessage[];
  outgoingAttacks: AttackUpdate[];
  incomingAttacks: AttackUpdate[];
  outgoingAllianceRequests: PlayerID[];
  alliances: AllianceView[];
  hasSpawned: boolean;
  betrayals: number;
  lastDeleteUnitTick: Tick;
  isLobbyCreator: boolean;
}

export interface AllianceView {
  id: number;
  other: PlayerID;
  createdAt: Tick;
  expiresAt: Tick;
  hasExtensionRequest: boolean;
}

export interface AllianceRequestUpdate {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
  allianceID: number;
}

export interface AllianceExpiredUpdate {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
}

export interface AllianceExtensionUpdate {
  type: GameUpdateType.AllianceExtension;
  playerID: number;
  allianceID: number;
}

export interface TargetPlayerUpdate {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  creditAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
}

export type DisplayChatMessageUpdate = {
  type: GameUpdateType.DisplayChatEvent;
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export interface WinUpdate {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  winner: Winner;
  /**
   * GDD §10 scoring breakdown for the run, populated by `WinCheckExecution`
   * via `Game.runScore()`. Optional so legacy callers (and tests that mock
   * `setWinner`) can omit it.
   */
  runScore?: RunScore;
}

export interface HashUpdate {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
}

export interface UnitIncomingUpdate {
  type: GameUpdateType.UnitIncoming;
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
}

export interface EmbargoUpdate {
  type: GameUpdateType.EmbargoEvent;
  event: "start" | "stop";
  playerID: number;
  embargoedID: number;
}

export interface GamePausedUpdate {
  type: GameUpdateType.GamePaused;
  paused: boolean;
}

export interface PeaceVoteUpdate {
  type: GameUpdateType.PeaceVote;
  /** smallID of the player casting the vote. */
  voterID: number;
  /** smallID of the allied player being endorsed as winner (the assist target). */
  targetID: number;
}
