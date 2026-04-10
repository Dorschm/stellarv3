import { simpleHash, toInt, withinInt } from "../Util";
import {
  AllUnitParams,
  FrigateType,
  MessageType,
  Player,
  Tick,
  TrajectoryTile,
  Unit,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { GameUpdateType, UnitUpdate } from "./GameUpdates";
import { PlayerImpl } from "./PlayerImpl";

export class UnitImpl implements Unit {
  private _active = true;
  private _targetTile: TileRef | undefined;
  private _targetUnit: Unit | undefined;
  private _health: bigint;
  private _lastTile: TileRef;
  private _retreating: boolean = false;
  private _targetedBySAM = false;
  private _reachedTarget = false;
  private _wasDestroyedByEnemy: boolean = false;
  private _destroyer: Player | undefined = undefined;
  private _lastSetSafeFromRaiders: number; // Only for trade ships
  private _underConstruction: boolean = false;
  private _lastOwner: PlayerImpl | null = null;
  private _troops: number;
  // Number of missiles in cooldown, if empty all missiles are ready.
  private _missileTimerQueue: number[] = [];
  private _hasTradeHub: boolean = false;
  private _patrolTile: TileRef | undefined;
  // GDD §14 / Ticket 6 — Battlecruiser structure slot. Only populated on
  // Battlecruiser units. Holds the single hosted structure (currently
  // DefenseStation or OrbitalStrikePlatform). Setter/getter live further
  // down; BattlecruiserExecution keeps the hosted structure glued to the
  // cruiser's tile on each tick.
  private _slottedStructure: Unit | undefined;
  private _level: number = 1;
  private _targetable: boolean = true;
  private _loaded: boolean | undefined;
  private _frigateType: FrigateType | undefined;
  // Nuke only
  private _trajectoryIndex: number = 0;
  private _trajectory: TrajectoryTile[];
  private _deletionAt: number | null = null;

  constructor(
    private _type: UnitType,
    private mg: GameImpl,
    private _tile: TileRef,
    private _id: number,
    public _owner: PlayerImpl,
    params: AllUnitParams = {},
  ) {
    this._lastTile = _tile;
    this._health = toInt(this.mg.unitInfo(_type).maxHealth ?? 1);
    this._targetTile =
      "targetTile" in params ? (params.targetTile ?? undefined) : undefined;
    this._trajectory = "trajectory" in params ? (params.trajectory ?? []) : [];
    this._troops = "troops" in params ? (params.troops ?? 0) : 0;
    this._lastSetSafeFromRaiders =
      "lastSetSafeFromRaiders" in params
        ? (params.lastSetSafeFromRaiders ?? 0)
        : 0;
    this._patrolTile =
      "patrolTile" in params ? (params.patrolTile ?? undefined) : undefined;
    this._targetUnit =
      "targetUnit" in params ? (params.targetUnit ?? undefined) : undefined;
    this._loaded =
      "loaded" in params ? (params.loaded ?? undefined) : undefined;
    this._frigateType =
      "frigateType" in params ? params.frigateType : undefined;

    switch (this._type) {
      case UnitType.Battlecruiser:
      case UnitType.Spaceport:
      case UnitType.OrbitalStrikePlatform:
      case UnitType.DefenseStation:
      case UnitType.PointDefenseArray:
      case UnitType.Colony:
      case UnitType.Foundry:
        this.mg.stats().unitBuild(_owner, this._type);
    }
  }

  setTargetable(targetable: boolean): void {
    if (this._targetable !== targetable) {
      this._targetable = targetable;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  isTargetable(): boolean {
    return this._targetable;
  }

  setPatrolTile(tile: TileRef): void {
    this._patrolTile = tile;
  }

  patrolTile(): TileRef | undefined {
    return this._patrolTile;
  }

  /**
   * Attach `structure` to this Battlecruiser's one-slot structure mount.
   * Throws if the slot is already occupied — callers are expected to check
   * {@link slottedStructure} first. See {@link Unit.setSlottedStructure}.
   */
  setSlottedStructure(structure: Unit | undefined): void {
    if (structure !== undefined && this._slottedStructure !== undefined) {
      throw new Error(
        `Battlecruiser slot already occupied by ${this._slottedStructure.type()}`,
      );
    }
    this._slottedStructure = structure;
  }

  slottedStructure(): Unit | undefined {
    return this._slottedStructure;
  }

  isUnit(): this is Unit {
    return true;
  }

  touch(): void {
    this.mg.addUpdate(this.toUpdate());
  }
  setTileTarget(tile: TileRef | undefined): void {
    this._targetTile = tile;
  }
  tileTarget(): TileRef | undefined {
    return this._targetTile;
  }

  id() {
    return this._id;
  }

  toUpdate(): UnitUpdate {
    return {
      type: GameUpdateType.Unit,
      unitType: this._type,
      id: this._id,
      troops: this._troops,
      ownerID: this._owner.smallID(),
      lastOwnerID: this._lastOwner?.smallID(),
      isActive: this._active,
      reachedTarget: this._reachedTarget,
      retreating: this._retreating,
      pos: this._tile,
      markedForDeletion: this._deletionAt ?? false,
      targetable: this._targetable,
      lastPos: this._lastTile,
      health: this.hasHealth() ? Number(this._health) : undefined,
      underConstruction: this._underConstruction,
      targetUnitId: this._targetUnit?.id() ?? undefined,
      targetTile: this.targetTile() ?? undefined,
      missileTimerQueue: this._missileTimerQueue,
      level: this.level(),
      hasTradeHub: this._hasTradeHub,
      frigateType: this._frigateType,
      loaded: this._loaded,
    };
  }

  type(): UnitType {
    return this._type;
  }

  lastTile(): TileRef {
    return this._lastTile;
  }

  move(tile: TileRef): void {
    if (tile === null) {
      throw new Error("tile cannot be null");
    }
    this._lastTile = this._tile;
    this._tile = tile;
    this.mg.onUnitMoved(this);
  }

  setTroops(troops: number): void {
    this._troops = Math.max(0, troops);
  }
  troops(): number {
    return this._troops;
  }
  health(): number {
    return Number(this._health);
  }
  hasHealth(): boolean {
    return this.info().maxHealth !== undefined;
  }
  tile(): TileRef {
    return this._tile;
  }
  owner(): PlayerImpl {
    return this._owner;
  }

  info(): UnitInfo {
    return this.mg.unitInfo(this._type);
  }

  setOwner(newOwner: PlayerImpl): void {
    this.clearPendingDeletion();
    switch (this._type) {
      case UnitType.Battlecruiser:
      case UnitType.Spaceport:
      case UnitType.OrbitalStrikePlatform:
      case UnitType.DefenseStation:
      case UnitType.PointDefenseArray:
      case UnitType.Colony:
      case UnitType.Foundry:
        this.mg.stats().unitCapture(newOwner, this._type);
        this.mg.stats().unitLose(this._owner, this._type);
        break;
    }
    this._lastOwner = this._owner;
    this._lastOwner._units = this._lastOwner._units.filter((u) => u !== this);
    this._owner = newOwner;
    this._owner._units.push(this);
    this.mg.addUpdate(this.toUpdate());
    this.mg.displayMessage(
      "events_display.unit_captured_by_enemy",
      MessageType.UNIT_CAPTURED_BY_ENEMY,
      this._lastOwner.id(),
      undefined,
      { unit: this.type(), name: newOwner.displayName() },
    );
    this.mg.displayMessage(
      "events_display.captured_enemy_unit",
      MessageType.CAPTURED_ENEMY_UNIT,
      newOwner.id(),
      undefined,
      { unit: this.type(), name: this._lastOwner.displayName() },
    );
  }

  modifyHealth(delta: number, attacker?: Player): void {
    this._health = withinInt(
      this._health + toInt(delta),
      0n,
      toInt(this.info().maxHealth ?? 1),
    );
    if (this._health === 0n) {
      this.delete(true, attacker);
    }
  }

  clearPendingDeletion(): void {
    this._deletionAt = null;
  }

  isMarkedForDeletion(): boolean {
    return this._deletionAt !== null;
  }

  markForDeletion(): void {
    if (!this.isActive()) {
      return;
    }
    this._deletionAt =
      this.mg.ticks() + this.mg.config().deletionMarkDuration();
    this.mg.addUpdate(this.toUpdate());
  }

  isOverdueDeletion(): boolean {
    if (!this.isActive()) {
      return false;
    }
    return this._deletionAt !== null && this.mg.ticks() - this._deletionAt > 0;
  }

  delete(displayMessage?: boolean, destroyer?: Player): void {
    if (!this.isActive()) {
      throw new Error(`cannot delete ${this} not active`);
    }

    // Record whether this unit was destroyed by an enemy (vs. arrived / retreated)
    this._wasDestroyedByEnemy = destroyer !== undefined;
    this._destroyer = destroyer ?? undefined;

    this._owner._units = this._owner._units.filter((b) => b !== this);
    this._active = false;
    this.mg.addUpdate(this.toUpdate());
    this.mg.removeUnit(this);

    // GDD §14 / Ticket 6 — a Battlecruiser's slotted structure is
    // physically part of the ship; destroying the cruiser destroys the
    // structure too. Guard with isActive() so we don't double-delete if
    // the structure was already removed independently.
    if (
      this._slottedStructure !== undefined &&
      this._slottedStructure.isActive()
    ) {
      const hosted = this._slottedStructure;
      this._slottedStructure = undefined;
      hosted.delete(false, destroyer);
    }

    if (displayMessage !== false) {
      this.displayMessageOnDeleted();
    }

    if (destroyer !== undefined) {
      switch (this._type) {
        case UnitType.AssaultShuttle:
          this.mg
            .stats()
            .shuttleDestroyTroops(destroyer, this._owner, this._troops);
          break;
        case UnitType.TradeFreighter:
          this.mg.stats().freighterDestroyTrade(destroyer, this._owner);
          break;
        case UnitType.Colony:
        case UnitType.DefenseStation:
        case UnitType.OrbitalStrikePlatform:
        case UnitType.Spaceport:
        case UnitType.PointDefenseArray:
        case UnitType.Battlecruiser:
        case UnitType.Foundry:
          this.mg.stats().unitDestroy(destroyer, this._type);
          this.mg.stats().unitLose(this.owner(), this._type);
          break;
      }
    }
  }

  private displayMessageOnDeleted(): void {
    if (this._type === UnitType.ClusterWarheadSubmunition) {
      return;
    }

    if (
      this._type === UnitType.Frigate &&
      this._frigateType !== FrigateType.Engine
    ) {
      return;
    }

    this.mg.displayMessage(
      "events_display.unit_destroyed",
      MessageType.UNIT_DESTROYED,
      this.owner().id(),
      undefined,
      { unit: this._type },
    );
  }

  isActive(): boolean {
    return this._active;
  }

  wasDestroyedByEnemy(): boolean {
    return this._wasDestroyedByEnemy;
  }

  destroyer(): Player | undefined {
    return this._destroyer;
  }

  retreating(): boolean {
    return this._retreating;
  }

  orderShuttleRetreat() {
    if (this.type() !== UnitType.AssaultShuttle) {
      throw new Error(`Cannot retreat ${this.type()}`);
    }
    if (!this._retreating) {
      this._retreating = true;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  isUnderConstruction(): boolean {
    return this._underConstruction;
  }

  setUnderConstruction(underConstruction: boolean): void {
    if (this._underConstruction !== underConstruction) {
      this._underConstruction = underConstruction;
      this.mg.addUpdate(this.toUpdate());
    }
  }

  hash(): number {
    return this.tile() + simpleHash(this.type()) * this._id;
  }

  toString(): string {
    return `Unit:${this._type},owner:${this.owner().name()}`;
  }

  launch(): void {
    this._missileTimerQueue.push(this.mg.ticks());
    this.mg.addUpdate(this.toUpdate());
  }

  ticksLeftInCooldown(): Tick | undefined {
    return this._missileTimerQueue[0];
  }

  isInCooldown(): boolean {
    return this._missileTimerQueue.length === this._level;
  }

  missileTimerQueue(): number[] {
    return this._missileTimerQueue;
  }

  reloadMissile(): void {
    this._missileTimerQueue.shift();
    this.mg.addUpdate(this.toUpdate());
  }

  setTargetTile(targetTile: TileRef | undefined) {
    this._targetTile = targetTile;
  }

  targetTile(): TileRef | undefined {
    return this._targetTile;
  }

  setTrajectoryIndex(i: number): void {
    const max = this._trajectory.length - 1;
    this._trajectoryIndex = i < 0 ? 0 : i > max ? max : i;
  }

  trajectoryIndex(): number {
    return this._trajectoryIndex;
  }

  trajectory(): TrajectoryTile[] {
    return this._trajectory;
  }

  setTargetUnit(target: Unit | undefined): void {
    this._targetUnit = target;
  }

  targetUnit(): Unit | undefined {
    return this._targetUnit;
  }

  setTargetedByPointDefense(targeted: boolean): void {
    this._targetedBySAM = targeted;
  }

  targetedByPointDefense(): boolean {
    return this._targetedBySAM;
  }

  setReachedTarget(): void {
    this._reachedTarget = true;
  }

  reachedTarget(): boolean {
    return this._reachedTarget;
  }

  setSafeFromRaiders(): void {
    this._lastSetSafeFromRaiders = this.mg.ticks();
  }

  isSafeFromRaiders(): boolean {
    return (
      this.mg.ticks() - this._lastSetSafeFromRaiders <
      this.mg.config().safeFromRaidersCooldownMax()
    );
  }

  level(): number {
    return this._level;
  }

  setTradeHub(trainStation: boolean): void {
    this._hasTradeHub = trainStation;
    this.mg.addUpdate(this.toUpdate());
  }

  hasTradeHub(): boolean {
    return this._hasTradeHub;
  }

  increaseLevel(): void {
    this._level++;
    if (
      [UnitType.OrbitalStrikePlatform, UnitType.PointDefenseArray].includes(
        this.type(),
      )
    ) {
      this._missileTimerQueue.push(this.mg.ticks());
    }
    this.mg.addUpdate(this.toUpdate());
  }

  decreaseLevel(destroyer?: Player): void {
    this._level--;
    if (
      [UnitType.OrbitalStrikePlatform, UnitType.PointDefenseArray].includes(
        this.type(),
      )
    ) {
      this._missileTimerQueue.pop();
    }
    if (this._level <= 0) {
      this.delete(true, destroyer);
      return;
    }
    this.mg.addUpdate(this.toUpdate());
  }

  frigateType(): FrigateType | undefined {
    return this._frigateType;
  }

  isLoaded(): boolean | undefined {
    return this._loaded;
  }

  setLoaded(loaded: boolean): void {
    if (this._loaded !== loaded) {
      this._loaded = loaded;
      this.mg.addUpdate(this.toUpdate());
    }
  }
}
