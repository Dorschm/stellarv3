import {
  AllPlayers,
  Credits,
  Difficulty,
  Game,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { ConstructionExecution } from "../ConstructionExecution";
import {
  EMOJI_BATTLECRUISER_RETALIATION,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";

export class NationBattlecruiserBehavior {
  // Track our assault shuttles we currently own
  private trackedAssaultShuttles: Set<Unit> = new Set();
  // Track our trade freighters we currently own
  private trackedTradeFreighters: Set<Unit> = new Set();

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  maybeSpawnBattlecruiser(): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Spaceport);
    const ships = this.player.units(UnitType.Battlecruiser);
    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.credits() > this.cost(UnitType.Battlecruiser)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.battlecruiserSpawnTile(port.tile());
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Battlecruiser, targetTile);
      if (canBuild === false) {
        return false;
      }
      this.game.addExecution(
        new ConstructionExecution(
          this.player,
          UnitType.Battlecruiser,
          targetTile,
        ),
      );
      return true;
    }
    return false;
  }

  private battlecruiserSpawnTile(portTile: TileRef): TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.game.x(portTile) - radius,
        this.game.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.game.y(portTile) - radius,
        this.game.y(portTile) + radius,
      );
      if (!this.game.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.game.ref(randX, randY);
      // Sanity check
      if (!this.game.isVoid(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  trackShipsAndRetaliate(): void {
    this.trackAssaultShuttlesAndRetaliate();
    this.trackTradeFreightersAndRetaliate();
  }

  // Send out a battlecruiser if our assault shuttle got destroyed
  private trackAssaultShuttlesAndRetaliate(): void {
    // Add any currently owned assault shuttles to our tracking set
    this.player
      .units(UnitType.AssaultShuttle)
      .forEach((u) => this.trackedAssaultShuttles.add(u));

    // Iterate tracked assault shuttles; if destroyed by an enemy: retaliate
    for (const ship of Array.from(this.trackedAssaultShuttles)) {
      if (!ship.isActive()) {
        // Distinguish between arrival/retreat and enemy destruction
        if (ship.wasDestroyedByEnemy() && ship.destroyer() !== undefined) {
          this.maybeRetaliateWithBattlecruiser(
            ship.tile(),
            ship.destroyer()!,
            "transport",
          );
        }
        this.trackedAssaultShuttles.delete(ship);
      }
    }
  }

  // Send out a battlecruiser if our trade freighter got captured
  private trackTradeFreightersAndRetaliate(): void {
    // Add any currently owned trade freighters to our tracking map
    this.player
      .units(UnitType.TradeFreighter)
      .forEach((u) => this.trackedTradeFreighters.add(u));

    // Iterate tracked trade freighters; if we no longer own it, it was captured: retaliate
    for (const ship of Array.from(this.trackedTradeFreighters)) {
      if (!ship.isActive()) {
        this.trackedTradeFreighters.delete(ship);
        continue;
      }
      if (ship.owner().id() !== this.player.id()) {
        // Ship was ours and is now owned by someone else -> captured
        this.maybeRetaliateWithBattlecruiser(
          ship.tile(),
          ship.owner(),
          "trade",
        );
        this.trackedTradeFreighters.delete(ship);
      }
    }
  }

  private maybeRetaliateWithBattlecruiser(
    tile: TileRef,
    enemy: Player,
    reason: "trade" | "transport",
  ): void {
    // Don't retaliate against ourselves (e.g. own nuke destroyed own ship)
    if (enemy === this.player) {
      return;
    }

    // Don't send too many battlecruisers
    if (this.player.units(UnitType.Battlecruiser).length >= 10) {
      return;
    }

    const { difficulty } = this.game.config().gameConfig();
    // In Easy never retaliate. In Medium retaliate with 15% chance. Hard with 50%, Impossible with 80%.
    if (
      (difficulty === Difficulty.Medium && this.random.nextInt(0, 100) < 15) ||
      (difficulty === Difficulty.Hard && this.random.nextInt(0, 100) < 50) ||
      (difficulty === Difficulty.Impossible && this.random.nextInt(0, 100) < 80)
    ) {
      const canBuild = this.player.canBuild(UnitType.Battlecruiser, tile);
      if (canBuild === false) {
        return;
      }
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Battlecruiser, tile),
      );
      this.emojiBehavior.maybeSendEmoji(enemy, EMOJI_BATTLECRUISER_RETALIATION);
      this.player.updateRelation(enemy, reason === "trade" ? -7.5 : -15);
    }
  }

  // Prevent battlecruiser infestations: if current player is one of the 3 richest and an enemy has too many battlecruisers, send a counter.
  // What is a battlecruiser infestation? A player tries to dominate deep space to block all trade freighters and assault shuttles.
  counterBattlecruiserInfestation(): void {
    if (!this.shouldCounterBattlecruiserInfestation()) {
      return;
    }

    const isTeamGame = this.player.team() !== null;

    if (!this.isRichPlayer(isTeamGame)) {
      return;
    }

    const target = this.findBattlecruiserInfestationCounterTarget(isTeamGame);
    if (target !== null) {
      this.buildCounterBattlecruiser(target);
    }
  }

  private shouldCounterBattlecruiserInfestation(): boolean {
    // Only the smart nations can do this
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }

    // Quit early if there aren't many battlecruisers in the game
    if (this.game.unitCount(UnitType.Battlecruiser) <= 10) {
      return false;
    }

    // Quit early if we can't afford a battlecruiser
    if (this.cost(UnitType.Battlecruiser) > this.player.credits()) {
      return false;
    }

    // Quit early if we don't have a spaceport to send battlecruisers from
    if (this.player.units(UnitType.Spaceport).length === 0) {
      return false;
    }

    // Don't send too many battlecruisers
    if (this.player.units(UnitType.Battlecruiser).length >= 10) {
      return false;
    }

    return true;
  }

  // Check if current player is one of the 3 richest (We don't want poor nations to use their precious credits on this)
  private isRichPlayer(isTeamGame: boolean): boolean {
    const players = this.game.players().filter((p) => {
      if (p.type() === PlayerType.Human) return false;
      return isTeamGame ? p.team() === this.player.team() : true;
    });
    const topThree = players
      .sort((a, b) => Number(b.credits() - a.credits()))
      .slice(0, 3);
    return topThree.some((p) => p.id() === this.player.id());
  }

  private findBattlecruiserInfestationCounterTarget(
    isTeamGame: boolean,
  ): { player: Player; battlecruiser: Unit } | null {
    return isTeamGame
      ? this.findTeamGameBattlecruiserTarget()
      : this.findFreeForAllBattlecruiserTarget();
  }

  private findTeamGameBattlecruiserTarget(): {
    player: Player;
    battlecruiser: Unit;
  } | null {
    const enemyTeamBattlecruisers = new Map<
      string,
      { count: number; team: string; players: Player[] }
    >();

    for (const p of this.game.players()) {
      // Skip friendly players (our team and allies)
      if (this.player.isFriendly(p) || p.id() === this.player.id()) {
        continue;
      }

      const team = p.team();
      if (team === null) continue;

      const teamKey = team.toString();
      const battlecruiserCount = p.units(UnitType.Battlecruiser).length;

      if (!enemyTeamBattlecruisers.has(teamKey)) {
        enemyTeamBattlecruisers.set(teamKey, {
          count: 0,
          team: teamKey,
          players: [],
        });
      }
      const teamData = enemyTeamBattlecruisers.get(teamKey)!;
      teamData.count += battlecruiserCount;
      teamData.players.push(p);
    }

    // Find team with more than 15 battlecruisers
    for (const [, teamData] of enemyTeamBattlecruisers.entries()) {
      if (teamData.count > 15) {
        // Find player in that team with most battlecruisers
        const playerWithMostBattlecruisers = teamData.players.reduce(
          (max, p) => {
            const count = p.units(UnitType.Battlecruiser).length;
            const maxCount = max ? max.units(UnitType.Battlecruiser).length : 0;
            return count > maxCount ? p : max;
          },
          null as Player | null,
        );

        if (playerWithMostBattlecruisers) {
          const bcs = playerWithMostBattlecruisers.units(
            UnitType.Battlecruiser,
          );
          if (bcs.length > 3) {
            return {
              player: playerWithMostBattlecruisers,
              battlecruiser: this.random.randElement(bcs),
            };
          }
        }
      }
    }

    return null;
  }

  private findFreeForAllBattlecruiserTarget(): {
    player: Player;
    battlecruiser: Unit;
  } | null {
    const enemies = this.game
      .players()
      .filter((p) => !this.player.isFriendly(p) && p.id() !== this.player.id());

    for (const enemy of enemies) {
      const enemyBattlecruisers = enemy.units(UnitType.Battlecruiser);
      if (enemyBattlecruisers.length > 10) {
        return {
          player: enemy,
          battlecruiser: this.random.randElement(enemyBattlecruisers),
        };
      }
    }

    return null;
  }

  private buildCounterBattlecruiser(target: {
    player: Player;
    battlecruiser: Unit;
  }): void {
    const canBuild = this.player.canBuild(
      UnitType.Battlecruiser,
      target.battlecruiser.tile(),
    );
    if (canBuild === false) {
      return;
    }

    this.game.addExecution(
      new ConstructionExecution(
        this.player,
        UnitType.Battlecruiser,
        target.battlecruiser.tile(),
      ),
    );
    this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_BATTLECRUISER_RETALIATION);
  }

  private cost(type: UnitType): Credits {
    return this.game.unitInfo(type).cost(this.game, this.player);
  }
}
