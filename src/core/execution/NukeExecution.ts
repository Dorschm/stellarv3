import {
  Execution,
  Game,
  MessageType,
  Player,
  Structures,
  TerraNullius,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { UniversalPathFinding } from "../pathfinding/PathFinder";
import { ParabolaUniversalPathFinder } from "../pathfinding/PathFinder.Parabola";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";
import { listNukeBreakAlliance } from "./Util";

const SPRITE_RADIUS = 16;

// Every UnitType *except* the in-flight nuke/missile types that the
// legacy `mg.units()` loop in `detonate()` skipped. Computed once at
// module load so the bounded `nearbyUnits` scan there doesn't have to
// allocate the list per detonation. Update this list if a new unit
// type ever lands that should also be immune to its sister nukes
// (or, conversely, vulnerable to them).
const KILLABLE_BY_NUKE: readonly UnitType[] = (
  Object.values(UnitType) as UnitType[]
).filter(
  (t) =>
    t !== UnitType.AntimatterTorpedo &&
    t !== UnitType.NovaBomb &&
    t !== UnitType.ClusterWarhead &&
    t !== UnitType.ClusterWarheadSubmunition &&
    t !== UnitType.PointDefenseMissile,
);

export class NukeExecution implements Execution {
  private active = true;
  private mg: Game;
  private nuke: Unit | null = null;
  private tilesToDestroyCache: Set<TileRef> | undefined;
  private pathFinder: ParabolaUniversalPathFinder;

  constructor(
    private nukeType: NukeType,
    private player: Player,
    private dst: TileRef,
    private src?: TileRef | null,
    private speed: number = -1,
    private waitTicks = 0,
    private rocketDirectionUp: boolean = true,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.speed === -1) {
      this.speed = this.mg.config().defaultNukeSpeed();
    }
    this.pathFinder = UniversalPathFinding.Parabola(mg, {
      increment: this.speed,
      distanceBasedHeight: this.nukeType !== UnitType.ClusterWarheadSubmunition,
      directionUp: this.rocketDirectionUp,
    });
  }

  public target(): Player | TerraNullius {
    return this.mg.owner(this.dst);
  }

  private tilesToDestroy(): Set<TileRef> {
    if (this.tilesToDestroyCache !== undefined) {
      return this.tilesToDestroyCache;
    }
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());
    const rand = new PseudoRandom(this.mg.ticks());
    const inner2 = magnitude.inner * magnitude.inner;
    const outer2 = magnitude.outer * magnitude.outer;
    this.tilesToDestroyCache = this.mg.bfs(this.dst, (_, n: TileRef) => {
      const d2 = this.mg?.euclideanDistSquared(this.dst, n) ?? 0;
      return d2 <= outer2 && (d2 <= inner2 || rand.chance(2));
    });
    return this.tilesToDestroyCache;
  }

  /**
   * Break alliances with players significantly affected by the nuke strike.
   * Uses weighted tile counting (inner=1, outer=0.5) OR if any allied structure would be destroyed.
   */
  private maybeBreakAlliances() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }
    if (this.nuke.type() === UnitType.ClusterWarheadSubmunition) {
      // Cluster warhead submunitions shouldn't break alliances
      return;
    }

    const magnitude = this.mg.config().nukeMagnitudes(this.nuke.type());

    const playersToBreakAllianceWith = listNukeBreakAlliance({
      game: this.mg,
      targetTile: this.dst,
      magnitude,
      threshold: this.mg.config().nukeAllianceBreakThreshold(),
    });

    // Automatically reject incoming alliance requests.
    for (const incoming of this.player.incomingAllianceRequests()) {
      if (playersToBreakAllianceWith.has(incoming.requestor().smallID())) {
        incoming.reject();
      }
    }

    for (const playerSmallId of playersToBreakAllianceWith) {
      const attackedPlayer = this.mg.playerBySmallID(playerSmallId);
      if (!attackedPlayer.isPlayer()) {
        continue;
      }

      // Resolves exploit of alliance breaking in which a pending alliance request
      // was accepted in the middle of a missile attack.
      const outgoingAllianceRequest = attackedPlayer
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === this.player);
      if (outgoingAllianceRequest) {
        outgoingAllianceRequest.reject();
        continue;
      }

      const alliance = this.player.allianceWith(attackedPlayer);
      if (alliance !== null) {
        this.player.breakAlliance(alliance);
      }
      if (attackedPlayer !== this.player) {
        attackedPlayer.updateRelation(this.player, -100);
      }
    }
  }

  tick(ticks: number): void {
    if (this.nuke === null) {
      let spawn: TileRef;
      if (this.nukeType === UnitType.ClusterWarheadSubmunition) {
        // Submunitions are spawned at the separation tile that MirvExecution
        // captured and passed in via the constructor. `canBuild(submunition,
        // dst)` returns `targetTile` (the destination) from
        // `PlayerImpl.canSpawnUnitType`, so calling it here would overwrite
        // `this.src` with the destination and build the submunition unit at
        // the impact point — shortening flight time and changing PDA
        // interception windows. Keep the constructor-provided `src`.
        if (this.src === undefined || this.src === null) {
          console.warn(`cannot build Nuke`);
          this.active = false;
          return;
        }
        spawn = this.src;
      } else {
        const built = this.player.canBuild(this.nukeType, this.dst);
        if (built === false) {
          console.warn(`cannot build Nuke`);
          this.active = false;
          return;
        }
        this.src = built;
        spawn = built;
      }
      // ClusterWarheadSubmunition skips trajectory storage. PDA's cluster
      // intercept path scans `nearbyUnits` and reads `targetTile()` only
      // (`PointDefenseArrayExecution.tick`, mirvWarheadTargets branch),
      // and the precise-intercept `computeInterceptionTile` only runs for
      // AntimatterTorpedo/NovaBomb. Computing a 350-element parabolic A*
      // per submunition is the single dominant cost in the MRV freeze.
      const trajectory =
        this.nukeType === UnitType.ClusterWarheadSubmunition
          ? []
          : this.getTrajectory(this.dst);
      this.nuke = this.player.buildUnit(this.nukeType, spawn, {
        targetTile: this.dst,
        trajectory,
      });
      if (this.nuke.type() !== UnitType.ClusterWarheadSubmunition) {
        this.maybeBreakAlliances();
      }
      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (!target.isPlayer()) {
          // Ignore terra nullius
        } else if (this.nukeType === UnitType.AntimatterTorpedo) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            "events_display.antimatter_torpedo_inbound",
            MessageType.NUKE_INBOUND,
            target.id(),
            { name: this.player.displayName() },
          );
        } else if (this.nukeType === UnitType.NovaBomb) {
          this.mg.displayIncomingUnit(
            this.nuke.id(),
            "events_display.nova_bomb_inbound",
            MessageType.NOVA_BOMB_INBOUND,
            target.id(),
            { name: this.player.displayName() },
          );
        }

        // Record stats
        this.mg.stats().bombLaunch(this.player, target, this.nukeType);
      }

      // after sending a nuke set the orbital strike platform on cooldown
      const platform = this.player
        .units(UnitType.OrbitalStrikePlatform)
        .find((platform) => platform.tile() === spawn);
      if (platform) {
        platform.launch();
      }
      return;
    }

    // make the nuke unactive if it was intercepted
    if (!this.nuke.isActive()) {
      console.log(`Nuke destroyed before reaching target`);
      this.active = false;
      return;
    }

    if (this.waitTicks > 0) {
      this.waitTicks--;
      return;
    }

    // Move to next tile
    const result = this.pathFinder.next(this.src!, this.dst, this.speed);
    if (result.status === PathStatus.COMPLETE) {
      this.detonate();
      return;
    } else if (result.status === PathStatus.NEXT) {
      this.updateNukeTargetable();
      this.nuke.move(result.node);
      // Update index so SAM can interpolate future position
      this.nuke.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  public getNuke(): Unit | null {
    return this.nuke;
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles = this.pathFinder.findPath(this.src!, target) ?? [];
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    nukeTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(nukeTile, targetTile) < targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, nukeTile) < targetRangeSquared)
    );
  }

  private updateNukeTargetable() {
    if (this.nuke === null || this.nuke.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.nuke.targetTile();
    this.nuke.setTargetable(
      this.isTargetable(targetTile!, this.nuke.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.nuke === null) {
      throw new Error("Not initialized");
    }

    const mg = this.mg;
    const config = mg.config();

    const magnitude = config.nukeMagnitudes(this.nuke.type());
    const toDestroy = this.tilesToDestroy();

    // Retrieve all impacted players and the number of tiles
    const tilesPerPlayers = new Map<Player, number>();
    for (const tile of toDestroy) {
      const owner = mg.owner(tile);
      if (owner.isPlayer()) {
        owner.relinquish(tile);
        tilesPerPlayers.set(owner, (tilesPerPlayers.get(owner) ?? 0) + 1);
      }

      if (mg.isSector(tile)) {
        mg.setFallout(tile, true);
      }
    }

    // Then compute the explosion effect on each player
    for (const [player, numImpactedTiles] of tilesPerPlayers) {
      const tilesBeforeNuke = player.numTilesOwned() + numImpactedTiles;
      const transportShips = player.units(UnitType.AssaultShuttle);
      const outgoingAttacks = player.outgoingAttacks();
      const maxPopulation = config.maxPopulation(player);
      // nukeDeathFactor could compute the complete fallout in a single call instead
      for (let i = 0; i < numImpactedTiles; i++) {
        // Diminishing effect as each affected tile has been nuked
        const numTilesLeft = tilesBeforeNuke - i;
        player.removePopulation(
          config.nukeDeathFactor(
            this.nukeType,
            player.population(),
            numTilesLeft,
            maxPopulation,
          ),
        );
        for (const attack of outgoingAttacks) {
          const attackPopulation = attack.population();
          const deaths = config.nukeDeathFactor(
            this.nukeType,
            attackPopulation,
            numTilesLeft,
            maxPopulation,
          );
          attack.setPopulation(attackPopulation - deaths);
        }
        for (const unit of transportShips) {
          const unitPopulation = unit.population();
          const deaths = config.nukeDeathFactor(
            this.nukeType,
            unitPopulation,
            numTilesLeft,
            maxPopulation,
          );
          unit.setPopulation(unitPopulation - deaths);
        }
      }
    }

    const outer2 = magnitude.outer * magnitude.outer;
    const dst = this.dst;
    const destroyer = this.player;
    // Bounded spatial scan instead of `mg.units()` (which walks every
    // unit in the game — including mid-flight submunitions for a sister
    // MRV). The blast can only touch units inside `outer`, so we ask the
    // spatial grid for that radius and skip the in-flight nuke types
    // the legacy loop skipped.
    //
    // `includeUnderConstruction = true` preserves the legacy `mg.units()`
    // semantics — the old loop walked every player unit without filtering
    // `isUnderConstruction()`, so half-built structures inside the blast
    // radius were destroyed alongside completed ones. `UnitGrid.nearbyUnits`
    // defaults that flag to `false`; we must opt back in to keep the
    // damage footprint unchanged.
    const killable = mg.nearbyUnits(
      dst,
      magnitude.outer,
      KILLABLE_BY_NUKE,
      undefined,
      true,
    );
    for (const entry of killable) {
      // `nearbyUnits` uses an axis-aligned grid; re-check euclidean
      // distance against `outer2` so the damage footprint matches the
      // legacy loop exactly.
      if (mg.euclideanDistSquared(dst, entry.unit.tile()) < outer2) {
        entry.unit.delete(true, destroyer);
      }
    }

    this.redrawBuildings(magnitude.outer + SPRITE_RADIUS);
    this.active = false;
    this.nuke.setReachedTarget();
    this.nuke.delete(false);

    // Record stats
    this.mg
      .stats()
      .bombLand(this.player, this.target(), this.nuke.type() as NukeType);
  }

  private redrawBuildings(range: number) {
    const rangeSquared = range * range;
    // Bounded scan via `nearbyUnits` so each submunition detonation
    // doesn't walk every unit in the game. `Structures.types` is the
    // same filter the legacy loop applied, and we re-check the
    // euclidean distance with the original `rangeSquared` so the touch
    // footprint is identical.
    //
    // `includeUnderConstruction = true` preserves the legacy `mg.units()`
    // semantics: the old loop touched every structure in range regardless
    // of construction state, so half-built structures within the redraw
    // footprint got the same `touch()` notification as completed ones.
    const nearby = this.mg.nearbyUnits(
      this.dst,
      range,
      Structures.types,
      undefined,
      true,
    );
    for (const entry of nearby) {
      if (
        this.mg.euclideanDistSquared(this.dst, entry.unit.tile()) < rangeSquared
      ) {
        entry.unit.touch();
      }
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
