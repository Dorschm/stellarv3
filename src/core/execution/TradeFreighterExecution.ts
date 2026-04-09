import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { findClosestBy } from "../Util";

export class TradeFreighterExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeFreighter: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: SteppingPathFinder<TileRef>;
  private tilesTraveled = 0;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Water(mg);
  }

  tick(ticks: number): void {
    if (this.tradeFreighter === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeFreighter,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade freighter`);
        this.active = false;
        return;
      }
      this.tradeFreighter = this.origOwner.buildUnit(
        UnitType.TradeFreighter,
        spawn,
        {
          targetUnit: this._dstPort,
          lastSetSafeFromRaiders: ticks,
        },
      );
      this.mg.stats().freighterSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeFreighter.isActive()) {
      this.active = false;
      return;
    }

    const tradeFreighterOwner = this.tradeFreighter.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeFreighterOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeFreighter.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeFreighterOwner.canTrade(dstPortOwner))
    ) {
      this.tradeFreighter.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeFreighter.tile();

    if (
      this.wasCaptured &&
      (tradeFreighterOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const nearestPort = findClosestBy(
        tradeFreighterOwner.units(UnitType.Spaceport),
        (port) => this.mg.manhattanDist(port.tile(), curTile),
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction(),
      );
      if (nearestPort === null) {
        this.tradeFreighter.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = nearestPort;
        this.tradeFreighter.setTargetUnit(this._dstPort);
        // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
        this.tradeFreighter.touch();
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    const dst = this._dstPort.tile();
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.findPath(from, dst) ?? [from];
          if (path.length === 0 || path[0] !== from) {
            path.unshift(from);
          }

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeFreighter.id(),
            planId: this.motionPlanId,
            startTick: ticks + 1,
            ticksPerStep: 1,
            path,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromRaiders status
        if (
          this.mg.isDeepSpace(result.node) &&
          this.mg.isSectorBoundary(result.node)
        ) {
          this.tradeFreighter.setSafeFromRaiders();
        }
        this.tradeFreighter.move(result.node);
        this.tilesTraveled++;
        break;
      case PathStatus.COMPLETE:
        this.complete();
        return;
      case PathStatus.NOT_FOUND:
        console.warn("captured trade freighter cannot find route");
        if (this.tradeFreighter.isActive()) {
          this.tradeFreighter.delete(false);
        }
        this.active = false;
        return;
    }
  }

  private complete() {
    this.active = false;
    this.tradeFreighter!.delete(false);
    const creditAmount = this.mg
      .config()
      .tradeFreighterCredits(this.tilesTraveled);

    if (this.wasCaptured) {
      this.tradeFreighter!.owner().addCredits(
        creditAmount,
        this._dstPort.tile(),
      );
      this.mg.displayMessage(
        "events_display.received_credits_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeFreighter!.owner().id(),
        creditAmount,
        {
          credits: renderNumber(creditAmount),
          name: this.origOwner.displayName(),
        },
      );
      // Record stats
      this.mg
        .stats()
        .freighterCapturedTrade(
          this.tradeFreighter!.owner(),
          this.origOwner,
          creditAmount,
        );
    } else {
      this.srcPort.owner().addCredits(creditAmount);
      this._dstPort.owner().addCredits(creditAmount, this._dstPort.tile());
      this.mg.displayMessage(
        "events_display.received_credits_from_trade",
        MessageType.RECEIVED_CREDITS_FROM_TRADE,
        this._dstPort.owner().id(),
        creditAmount,
        {
          credits: renderNumber(creditAmount),
          name: this.srcPort.owner().displayName(),
        },
      );
      this.mg.displayMessage(
        "events_display.received_credits_from_trade",
        MessageType.RECEIVED_CREDITS_FROM_TRADE,
        this.srcPort.owner().id(),
        creditAmount,
        {
          credits: renderNumber(creditAmount),
          name: this._dstPort.owner().displayName(),
        },
      );
      // Record stats
      this.mg
        .stats()
        .freighterArriveTrade(
          this.srcPort.owner(),
          this._dstPort.owner(),
          creditAmount,
        );
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}
