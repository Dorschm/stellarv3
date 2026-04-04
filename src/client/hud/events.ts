import { GameEvent } from "../../core/EventBus";
import { PlayerActions } from "../../core/game/Game";
import { PlayerView, UnitView } from "../../core/game/GameView";
import { TileRef } from "../../core/game/GameMap";

// -- Navigation events (from Leaderboard.ts, AttacksDisplay.ts) --
export class GoToPlayerEvent implements GameEvent {
  constructor(public player: PlayerView) {}
}

export class GoToPositionEvent implements GameEvent {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export class GoToUnitEvent implements GameEvent {
  constructor(public unit: UnitView) {}
}

// -- Bar visibility events (from SpawnTimer.ts / ImmunityTimer.ts) --
export class SpawnBarVisibleEvent implements GameEvent {
  constructor(public readonly visible: boolean) {}
}

export class ImmunityBarVisibleEvent implements GameEvent {
  constructor(public readonly visible: boolean) {}
}

// -- Modal events (from SettingsModal.ts / ReplayPanel.ts) --
export class ShowSettingsModalEvent implements GameEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

export class ShowReplayPanelEvent implements GameEvent {
  constructor(
    public visible: boolean = true,
    public isSingleplayer: boolean = false,
  ) {}
}

// -- Player panel event (from RadialMenuElements.ts → PlayerPanel.tsx) --
export class ShowPlayerPanelEvent implements GameEvent {
  constructor(
    public actions: PlayerActions,
    public tile: TileRef,
  ) {}
}

// -- Radial menu event (from RadialMenu.ts) --
export class CloseRadialMenuEvent implements GameEvent {
  constructor() {}
}

// -- Railroad event (from RailroadLayer.ts) --
export class RailTileChangedEvent implements GameEvent {
  constructor(public tile: TileRef) {}
}
