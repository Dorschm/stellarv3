import { renderTroops } from "../../client/Utils";
import { targetShuttleTile } from "../game/AssaultShuttleUtils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { AttackExecution } from "./AttackExecution";

const malusForRetreat = 25;

export class AssaultShuttleExecution implements Execution {
  private active = true;

  // TODO: make this configurable
  private ticksPerMove = 1;
  private lastMove: number;

  private mg: Game;
  private target: Player | TerraNullius;
  private pathFinder: SteppingPathFinder<TileRef>;

  private dst: TileRef | null;
  private src: TileRef | null;
  private retreatDst: TileRef | false | null = null;
  private shuttle: Unit;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  private originalOwner: Player;

  constructor(
    private attacker: Player,
    private ref: TileRef,
    private troops: number,
  ) {
    this.originalOwner = this.attacker;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!mg.isValidRef(this.ref)) {
      console.warn(`AssaultShuttleExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.target = mg.owner(this.ref);
    this.pathFinder = PathFinding.Water(mg);

    if (
      this.attacker.unitCount(UnitType.AssaultShuttle) >=
      mg.config().shuttleMaxNumber()
    ) {
      mg.displayMessage(
        "events_display.no_boats_available",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
        undefined,
        { max: mg.config().shuttleMaxNumber() },
      );
      this.active = false;
      return;
    }

    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this.attacker.type() !== PlayerType.Bot
      ) {
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target.isPlayer() && !this.attacker.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    this.troops ??= this.mg
      .config()
      .shuttleAttackAmount(this.attacker, this.target);
    this.troops = Math.min(this.troops, this.attacker.troops());

    this.dst = targetShuttleTile(this.mg, this.ref);

    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find target tile`,
      );
      this.active = false;
      return;
    }

    const src = this.attacker.canBuild(UnitType.AssaultShuttle, this.dst);

    if (src === false) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find start tile`,
      );
      this.active = false;
      return;
    }

    this.src = src;

    this.shuttle = this.attacker.buildUnit(UnitType.AssaultShuttle, this.src, {
      troops: this.troops,
      targetTile: this.dst,
    });

    const fullPath = this.pathFinder.findPath(this.src, this.dst) ?? [this.src];
    if (fullPath.length === 0 || fullPath[0] !== this.src) {
      fullPath.unshift(this.src);
    }

    const motionPlan: MotionPlanRecord = {
      kind: "grid",
      unitId: this.shuttle.id(),
      planId: this.motionPlanId,
      startTick: ticks + this.ticksPerMove,
      ticksPerStep: this.ticksPerMove,
      path: fullPath,
    };
    this.mg.recordMotionPlan(motionPlan);
    this.motionPlanDst = this.dst;

    // Notify the target player about the incoming naval invasion
    if (this.target.id() !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.shuttle.id(),
        // TODO TranslateText
        `Shuttle assault incoming from ${this.attacker.displayName()} (${renderTroops(this.shuttle.troops())})`,
        MessageType.ORBITAL_ASSAULT_INBOUND,
        this.target.id(),
      );
    }

    // Record stats
    this.mg
      .stats()
      .shuttleSendTroops(this.attacker, this.target, this.shuttle.troops());
  }

  tick(ticks: number) {
    if (this.dst === null) {
      this.active = false;
      return;
    }
    if (!this.active) {
      return;
    }
    if (!this.shuttle.isActive()) {
      this.active = false;
      return;
    }
    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    // Team mate can conquer disconnected player and get their ships
    // captureUnit has changed the owner of the unit, now update attacker
    const shuttleOwner = this.shuttle.owner();
    if (
      this.originalOwner.isDisconnected() &&
      shuttleOwner !== this.originalOwner &&
      shuttleOwner.isOnSameTeam(this.originalOwner)
    ) {
      this.attacker = shuttleOwner;
      this.originalOwner = shuttleOwner; // for when this owner disconnects too
    }

    if (this.shuttle.retreating()) {
      // Resolve retreat destination once, based on current shuttle location when retreat begins.
      this.retreatDst ??= this.attacker.bestShuttleSpawn(this.shuttle.tile());

      if (this.retreatDst === false) {
        console.warn(
          `AssaultShuttleExecution: retreating but no retreat destination found`,
        );
        this.attacker.addTroops(this.shuttle.troops());
        this.shuttle.delete(false);
        this.active = false;
        return;
      } else {
        this.dst = this.retreatDst;

        if (this.shuttle.targetTile() !== this.dst) {
          this.shuttle.setTargetTile(this.dst);
        }
      }
    }

    const result = this.pathFinder.next(this.shuttle.tile(), this.dst);
    switch (result.status) {
      case PathStatus.COMPLETE:
        if (this.mg.owner(this.dst) === this.attacker) {
          const deaths = this.shuttle.troops() * (malusForRetreat / 100);
          const survivors = this.shuttle.troops() - deaths;
          this.attacker.addTroops(survivors);
          this.shuttle.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .shuttleArriveTroops(this.attacker, this.target, survivors);
          if (deaths) {
            this.mg.displayMessage(
              "events_display.attack_cancelled_retreat",
              MessageType.ATTACK_CANCELLED,
              this.attacker.id(),
              undefined,
              { troops: renderTroops(deaths) },
            );
          }
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.shuttle.troops());
        } else {
          this.mg.addExecution(
            new AttackExecution(
              this.shuttle.troops(),
              this.attacker,
              this.target.id(),
              this.dst,
              false,
            ),
          );
        }
        this.shuttle.delete(false);
        this.active = false;

        // Record stats
        this.mg
          .stats()
          .shuttleArriveTroops(
            this.attacker,
            this.target,
            this.shuttle.troops(),
          );
        return;
      case PathStatus.NEXT:
        this.shuttle.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        // TODO: add to poisoned port list
        const map = this.mg.map();
        const shuttleTile = this.shuttle.tile();
        console.warn(
          `AssaultShuttle path not found: shuttle@(${map.x(shuttleTile)},${map.y(shuttleTile)}) -> dst@(${map.x(this.dst)},${map.y(this.dst)}), attacker=${this.attacker.id()}, target=${this.target.id()}`,
        );
        this.attacker.addTroops(this.shuttle.troops());
        this.shuttle.delete(false);
        this.active = false;
        return;
      }
    }

    if (this.dst !== null && this.dst !== this.motionPlanDst) {
      this.motionPlanId++;
      const fullPath = this.pathFinder.findPath(
        this.shuttle.tile(),
        this.dst,
      ) ?? [this.shuttle.tile()];
      if (fullPath.length === 0 || fullPath[0] !== this.shuttle.tile()) {
        fullPath.unshift(this.shuttle.tile());
      }

      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.shuttle.id(),
        planId: this.motionPlanId,
        startTick: ticks + this.ticksPerMove,
        ticksPerStep: this.ticksPerMove,
        path: fullPath,
      });
      this.motionPlanDst = this.dst;
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this.attacker
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }
}
