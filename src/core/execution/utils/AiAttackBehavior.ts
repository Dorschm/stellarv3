import { canBuildAssaultShuttle } from "../../game/AssaultShuttleUtils";
import {
  Difficulty,
  Game,
  GameMode,
  GameType,
  HumansVsNations,
  Player,
  PlayerID,
  PlayerType,
  Relation,
  Structures,
  TerraNullius,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import {
  assertNever,
  boundingBoxCenter,
  calculateBoundingBoxCenter,
} from "../../Util";
import { AssaultShuttleExecution } from "../AssaultShuttleExecution";
import { AttackExecution } from "../AttackExecution";
import { DonatePopulationExecution } from "../DonatePopulationExecution";
import { NationAllianceBehavior } from "../nation/NationAllianceBehavior";
import {
  EMOJI_ASSIST_ACCEPT,
  EMOJI_ASSIST_RELATION_TOO_LOW,
  EMOJI_ASSIST_TARGET_ALLY,
  EMOJI_ASSIST_TARGET_ME,
  NationEmojiBehavior,
} from "../nation/NationEmojiBehavior";
import { closestTwoTiles } from "../Util";

export class AiAttackBehavior {
  private botAttackPopulationSent: number = 0;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
    private expandRatio: number,
    private allianceBehavior?: NationAllianceBehavior,
    private emojiBehavior?: NationEmojiBehavior,
  ) {}

  maybeAttack() {
    if (this.player === null || this.allianceBehavior === undefined) {
      throw new Error("not initialized");
    }

    const border = Array.from(this.player.borderTiles())
      .flatMap((t) => this.game.neighbors(t))
      .filter(
        (t) =>
          this.game.isSector(t) &&
          this.game.ownerID(t) !== this.player?.smallID(),
      );
    const borderingPlayers = [
      ...new Set(
        border
          .map((t) => this.game.playerBySmallID(this.game.ownerID(t)))
          .filter((o): o is Player => o.isPlayer()),
      ),
    ].sort((a, b) => a.population() - b.population());
    const borderingFriends = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === true,
    );
    const borderingEnemies = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === false,
    );

    // Attack TerraNullius but not nuked territory
    const hasNonNukedTerraNullius = border.some(
      (t) => !this.game.hasOwner(t) && !this.game.hasFallout(t),
    );
    if (hasNonNukedTerraNullius) {
      this.sendAttack(this.game.terraNullius());
      return;
    }

    if (borderingEnemies.length === 0) {
      if (this.random.chance(5)) {
        this.attackWithRandomBoat();
      }
    } else {
      if (this.random.chance(10)) {
        this.attackWithRandomBoat(borderingEnemies);
        return;
      }

      this.allianceBehavior.maybeSendAllianceRequests(borderingEnemies);
    }

    this.attackBestTarget(borderingFriends, borderingEnemies);
  }

  private attackWithRandomBoat(borderingEnemies: Player[] = []) {
    if (this.player === null) throw new Error("not initialized");

    // Check if we've already sent out the maximum number of transport ships
    if (
      this.player.unitCount(UnitType.AssaultShuttle) >=
      this.game.config().shuttleMaxNumber()
    ) {
      return;
    }

    // Check if we have any void shore tiles to launch from
    const voidShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.game.isVoidShore(t),
    );
    if (voidShore.length === 0) {
      return;
    }

    const src = this.random.randElement(voidShore);

    // First look for high-interest targets (unowned or bot-owned). Mainly relevant for earlygame
    let dst = this.findRandomBoatTarget(src, borderingEnemies, true);
    if (dst === null) {
      // None found? Then look for players
      dst = this.findRandomBoatTarget(src, borderingEnemies, false);
      if (dst === null) {
        return;
      }
    }

    this.game.addExecution(
      new AssaultShuttleExecution(
        this.player,
        dst,
        this.player.population() / 5,
      ),
    );
    return;
  }

  private findRandomBoatTarget(
    tile: TileRef,
    borderingEnemies: Player[],
    highInterestOnly: boolean = false,
  ): TileRef | null {
    if (this.player === null) throw new Error("not initialized");
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    const unreachablePlayers = new Set<PlayerID>();
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - 150, x + 150);
      const randY = this.random.nextInt(y - 150, y + 150);
      if (!this.game.isValidCoord(randX, randY)) {
        continue;
      }
      const randTile = this.game.ref(randX, randY);
      if (!this.game.isSector(randTile)) {
        continue;
      }
      const owner = this.game.owner(randTile);
      if (owner === this.player) {
        continue;
      }
      // Skip players we already know are unreachable (Performance optimization)
      if (owner.isPlayer() && unreachablePlayers.has(owner.id())) {
        continue;
      }
      // Don't send boats to players with which we share a border, that usually looks stupid
      if (owner.isPlayer() && borderingEnemies.includes(owner)) {
        continue;
      }
      // Don't spam boats into players which are stronger than us
      if (owner.isPlayer() && owner.population() > this.player.population()) {
        continue;
      }

      let matchesCriteria = false;
      if (highInterestOnly) {
        // High-interest targeting: prioritize unowned tiles or tiles owned by bots
        matchesCriteria = !owner.isPlayer() || owner.type() === PlayerType.Bot;
      } else {
        // Normal targeting: return unowned tiles or tiles owned by non-friendly players
        matchesCriteria = !owner.isPlayer() || !owner.isFriendly(this.player);
      }
      if (!matchesCriteria) {
        continue;
      }

      // Validate that we can actually build a transport ship to this target
      if (canBuildAssaultShuttle(this.game, this.player, randTile) === false) {
        if (owner.isPlayer()) {
          unreachablePlayers.add(owner.id());
        }
        continue;
      }

      return randTile;
    }
    return null;
  }

  // attackBestTarget is called with borderingFriends and borderingEnemies sorted by population (ascending)
  private attackBestTarget(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ) {
    // In games with high starting gold, nations will quickly build a lot of cities
    // This causes them to expand slowly (cities increase max population), and bots will steal their structures
    // In this case: Attack bots before ratio checks
    if (this.hasNeighboringBotWithStructures()) {
      if (this.attackBots()) return;
    }

    // Save up population until we reach the reserve ratio
    if (!this.hasReserveRatioPopulation()) return;

    // Maybe save up population until we reach the trigger ratio
    if (!this.hasTriggerRatioPopulation() && !this.random.chance(10)) return;

    // Get attack strategies in priority order based on difficulty
    const strategies = this.getAttackStrategies(
      borderingFriends,
      borderingEnemies,
    );

    for (const strategy of strategies) {
      if (strategy()) return;
    }
  }

  private getAttackStrategies(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): Array<() => boolean> {
    const { difficulty } = this.game.config().gameConfig();

    // Define all strategies as functions that return true if they attacked
    const retaliate = (): boolean => {
      const attacker = this.findIncomingAttackPlayer();
      if (attacker) {
        this.sendAttack(attacker, true);
        return true;
      }
      return false;
    };

    const bots = (): boolean => this.attackBots();

    const assist = (): boolean => this.assistAllies();

    const traitor = (): boolean => {
      const traitor = this.findTraitor(borderingEnemies);
      if (traitor) {
        this.sendAttack(traitor);
        return true;
      }
      return false;
    };

    const afk = (): boolean => {
      // borderingEnemies is already sorted by population (ascending), so first match is weakest afk enemy
      const afk = borderingEnemies.find(
        (enemy) =>
          enemy.isDisconnected() &&
          enemy.population() < this.player.population() * 3,
      );
      if (afk) {
        this.sendAttack(afk);
        return true;
      }
      return false;
    };

    const betray = (): boolean =>
      this.maybeBetrayAndAttack(borderingFriends, borderingEnemies);

    const nuked = (): boolean => {
      if (this.isBorderingNukedTerritory()) {
        this.sendAttack(this.game.terraNullius());
        return true;
      }
      return false;
    };

    const victim = (): boolean => {
      const victim = this.findVictim(borderingEnemies);
      if (victim) {
        this.sendAttack(victim);
        return true;
      }
      return false;
    };

    const hated = (): boolean => {
      for (const relation of this.player.allRelationsSorted()) {
        if (relation.relation !== Relation.Hostile) continue;
        const other = relation.player;
        if (this.player.isFriendly(other)) continue;
        if (other.population() > this.player.population() * 3) continue;
        this.sendAttack(other);
        return true;
      }
      return false;
    };

    const veryWeak = (): boolean => {
      const veryWeak = this.findVeryWeakEnemy(borderingEnemies);
      if (veryWeak) {
        this.sendAttack(veryWeak);
        return true;
      }
      return false;
    };

    const weakest = (): boolean => {
      if (borderingEnemies.length > 0) {
        // borderingEnemies is already sorted by population (ascending), so first match is weakest
        const weakest = borderingEnemies[0];
        // Don't attack if they have more population than us
        if (weakest.population() < this.player.population()) {
          this.sendAttack(weakest);
          return true;
        }
      }
      return false;
    };

    const island = (): boolean => {
      if (borderingEnemies.length === 0) {
        const enemy = this.findNearestIslandEnemy();
        if (enemy) {
          this.sendAttack(enemy);
          return true;
        }
      }
      return false;
    };

    const donate = (): boolean => this.donatePopulation();

    // Return strategies in order based on difficulty
    // Easy nations get the dumbest order, impossible nations get the smartest order
    switch (difficulty) {
      case Difficulty.Easy:
        // prettier-ignore
        return [nuked, bots, retaliate, assist, betray, hated, weakest];
      case Difficulty.Medium:
        // prettier-ignore
        return [bots, nuked, retaliate, assist, betray, hated, afk, traitor, weakest, island, donate];
      case Difficulty.Hard:
        // prettier-ignore
        return [bots, retaliate, assist, betray, nuked, traitor, afk, hated, veryWeak, victim, weakest, island, donate];
      case Difficulty.Impossible:
        // prettier-ignore
        return [retaliate, bots, veryWeak, assist, traitor, afk, betray, victim, nuked, hated, weakest, island, donate];
      default:
        assertNever(difficulty);
    }
  }

  private hasNeighboringBotWithStructures(): boolean {
    return this.player
      .neighbors()
      .some(
        (n) =>
          n.isPlayer() &&
          n.type() === PlayerType.Bot &&
          !this.player.isFriendly(n) &&
          n.units().some((u) => Structures.has(u.type())),
      );
  }

  private hasReserveRatioPopulation(): boolean {
    const maxPopulation = this.game.config().maxPopulation(this.player);
    const ratio = this.player.population() / maxPopulation;
    return ratio >= this.reserveRatio;
  }

  private hasTriggerRatioPopulation(): boolean {
    const maxPopulation = this.game.config().maxPopulation(this.player);
    const ratio = this.player.population() / maxPopulation;
    return ratio >= this.triggerRatio;
  }

  findIncomingAttackPlayer(): Player | null {
    // Ignore bot attacks if we are not a bot.
    let incomingAttacks = this.player.incomingAttacks();
    if (this.player.type() !== PlayerType.Bot) {
      incomingAttacks = incomingAttacks.filter(
        (attack) => attack.attacker().type() !== PlayerType.Bot,
      );
    }
    let largestAttack = 0;
    let largestAttacker: Player | undefined;
    for (const attack of incomingAttacks) {
      if (attack.population() <= largestAttack) continue;
      largestAttack = attack.population();
      largestAttacker = attack.attacker();
    }
    if (largestAttacker !== undefined) {
      return largestAttacker;
    }
    return null;
  }

  // Sort neighboring bots by density (population / tiles) and attempt to attack many of them (Parallel attacks)
  // sendAttack will do nothing if we don't have enough reserve population left
  // Bots that own structures are prioritized as targets (they might have stolen our structures and they will delete them!)
  private attackBots(): boolean {
    const bots = this.player
      .neighbors()
      .filter(
        (n): n is Player =>
          n.isPlayer() &&
          this.player.isFriendly(n) === false &&
          n.type() === PlayerType.Bot,
      );

    if (bots.length === 0) {
      return false;
    }

    this.botAttackPopulationSent = 0;

    const density = (p: Player) => p.population() / p.numTilesOwned();
    const ownsStructures = (p: Player) =>
      p.units().some((u) => Structures.has(u.type()));
    const sortedBots = bots.slice().sort((a, b) => {
      const aHasStructures = ownsStructures(a);
      const bHasStructures = ownsStructures(b);
      if (aHasStructures !== bHasStructures) {
        return aHasStructures ? -1 : 1;
      }
      return density(a) - density(b);
    });
    const reducedBots = sortedBots.slice(0, this.getBotAttackMaxParallelism());

    for (const bot of reducedBots) {
      this.sendAttack(bot);
    }

    // Only short-circuit the rest of the targeting pipeline if we actually
    // allocated some population to bot attacks.
    return this.botAttackPopulationSent > 0;
  }

  private getBotAttackMaxParallelism(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return this.random.chance(2) ? 1 : 2;
      case Difficulty.Hard:
        return 3;
      // On impossible difficulty, attack as much bots as possible in parallel
      case Difficulty.Impossible: {
        return 100;
      }
      default:
        assertNever(difficulty);
    }
  }

  private assistAllies(): boolean {
    if (this.emojiBehavior === undefined) throw new Error("not initialized");

    for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) {
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_RELATION_TOO_LOW);
        continue;
      }
      for (const target of ally.targets()) {
        if (target === this.player) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ME);
          continue;
        }
        if (this.player.isFriendly(target)) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ALLY);
          continue;
        }
        // All checks passed, assist them
        this.player.updateRelation(ally, -20);
        this.sendAttack(target);
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_ACCEPT);
        return true;
      }
    }
    return false;
  }

  // Find a traitor who isn't significantly stronger than us
  private findTraitor(borderingEnemies: Player[]): Player | null {
    // borderingEnemies is already sorted by population (ascending), so first match is weakest traitor
    return (
      borderingEnemies.find(
        (enemy) =>
          enemy.isTraitor() &&
          enemy.population() < this.player.population() * 1.2,
      ) ?? null
    );
  }

  private maybeBetrayAndAttack(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): boolean {
    if (this.allianceBehavior === undefined) throw new Error("not initialized");

    if (borderingFriends.length > 0) {
      for (const friend of borderingFriends) {
        if (
          this.allianceBehavior.maybeBetray(
            friend,
            borderingFriends.length + borderingEnemies.length,
          )
        ) {
          this.sendAttack(friend, true);
          return true;
        }
      }
    }
    return false;
  }

  private isBorderingNukedTerritory(): boolean {
    for (const tile of this.player.borderTiles()) {
      for (const neighbor of this.game.neighbors(tile)) {
        if (
          this.game.isSector(neighbor) &&
          !this.game.hasOwner(neighbor) &&
          this.game.hasFallout(neighbor)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // Find someone who isn't significantly stronger than us and is under big attack from others (50%+ of their population incoming)
  private findVictim(borderingEnemies: Player[]): Player | null {
    // borderingEnemies is already sorted by population (ascending), so first match is weakest victim
    return (
      borderingEnemies.find((enemy) => {
        if (enemy.population() > this.player.population() * 1.2) return false;

        const totalIncomingPopulation = enemy
          .incomingAttacks()
          .reduce((sum, attack) => sum + attack.population(), 0);

        return totalIncomingPopulation > enemy.population() * 0.5;
      }) ?? null
    );
  }

  // Find very weak (less than 15% of their maxPopulation) enemies
  // which also don't have significantly more population than us (to target MIRVed players)
  private findVeryWeakEnemy(borderingEnemies: Player[]): Player | null {
    const veryWeakEnemies = borderingEnemies.filter((enemy) => {
      const enemyMaxPopulation = this.game.config().maxPopulation(enemy);
      return (
        enemy.population() < enemyMaxPopulation * 0.15 &&
        enemy.population() < this.player.population() * 1.2
      );
    });

    // borderingEnemies is already sorted by population (ascending), so first match is weakest very weak enemy
    return veryWeakEnemies.length > 0 ? veryWeakEnemies[0] : null;
  }

  private findNearestIslandEnemy(): Player | null {
    // Check if we've already sent out the maximum number of transport ships
    if (
      this.player.unitCount(UnitType.AssaultShuttle) >=
      this.game.config().shuttleMaxNumber()
    ) {
      return null;
    }

    // Check if we have any void shore tiles to launch from
    const hasOceanShore = Array.from(this.player.borderTiles()).some((t) =>
      this.game.isVoidShore(t),
    );
    if (!hasOceanShore) return null;

    const filteredPlayers = this.game.players().filter((p) => {
      if (p === this.player) return false;
      if (this.player.isFriendly(p)) return false;
      // Don't spam boats into players with more population
      return p.population() < this.player.population();
    });

    if (filteredPlayers.length === 0) return null;

    const playerCenter = this.getPlayerCenter(this.player);

    const sortedPlayers = filteredPlayers
      .map((filteredPlayer) => {
        const filteredPlayerCenter = this.getPlayerCenter(filteredPlayer);

        const playerCenterTile = this.game.ref(playerCenter.x, playerCenter.y);
        const filteredPlayerCenterTile = this.game.ref(
          filteredPlayerCenter.x,
          filteredPlayerCenter.y,
        );

        const distance = this.game.manhattanDist(
          playerCenterTile,
          filteredPlayerCenterTile,
        );
        return { player: filteredPlayer, distance };
      })
      .sort((a, b) => a.distance - b.distance); // Sort by distance (ascending)

    // Try players in order of distance until we find reachable candidates
    const reachablePlayers: Player[] = [];
    for (const entry of sortedPlayers) {
      const closest = closestTwoTiles(
        this.game,
        Array.from(this.player.borderTiles()).filter((t) =>
          this.game.isVoidShore(t),
        ),
        Array.from(entry.player.borderTiles()).filter((t) =>
          this.game.isVoidShore(t),
        ),
      );
      if (closest === null) continue;

      if (canBuildAssaultShuttle(this.game, this.player, closest.y)) {
        reachablePlayers.push(entry.player);
        // We only need up to 2 reachable candidates
        if (reachablePlayers.length >= 2) break;
      }
    }

    if (reachablePlayers.length === 0) return null;

    // 33% chance to pick the second-nearest player if available
    if (reachablePlayers.length >= 2 && this.random.chance(3)) {
      return reachablePlayers[1];
    }

    return reachablePlayers[0];
  }

  private getPlayerCenter(player: Player) {
    if (player.largestClusterBoundingBox) {
      return boundingBoxCenter(player.largestClusterBoundingBox);
    }
    return calculateBoundingBoxCenter(this.game, player.borderTiles());
  }

  attackRandomTarget() {
    // Save up population until we reach the trigger ratio
    if (!this.hasTriggerRatioPopulation()) return;

    // Retaliate against incoming attacks
    const incomingAttackPlayer = this.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      this.sendAttack(incomingAttackPlayer, true);
      return;
    }

    // Select a traitor as an enemy
    const toAttack = this.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      if (this.random.chance(3)) {
        this.sendAttack(toAttack);
        return;
      }
    }

    // Choose a new enemy randomly
    const neighbors = this.player.neighbors();
    for (const neighbor of this.random.shuffleArray(neighbors)) {
      if (!neighbor.isPlayer()) continue;
      if (this.player.isFriendly(neighbor)) continue;
      if (
        neighbor.type() === PlayerType.Nation ||
        neighbor.type() === PlayerType.Human
      ) {
        if (this.random.chance(2)) {
          continue;
        }
      }
      this.sendAttack(neighbor);
      return;
    }
  }

  getNeighborTraitorToAttack(): Player | null {
    const traitors = this.player
      .neighbors()
      .filter(
        (n): n is Player =>
          n.isPlayer() && this.player.isFriendly(n) === false && n.isTraitor(),
      );
    return traitors.length > 0 ? this.random.randElement(traitors) : null;
  }

  forceSendAttack(target: Player | TerraNullius) {
    this.game.addExecution(
      new AttackExecution(
        this.player.population() / 2,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );
  }

  sendAttack(target: Player | TerraNullius, force = false) {
    if (!force && !this.shouldAttack(target)) return;

    if (this.player.sharesBorderWith(target)) {
      this.sendLandAttack(target);
    } else if (target.isPlayer()) {
      this.sendBoatAttack(target);
    }
  }

  shouldAttack(other: Player | TerraNullius): boolean {
    if (
      // Always attack Terra Nullius, non-humans and traitors
      other.isPlayer() === false ||
      other.type() !== PlayerType.Human ||
      other.isTraitor() ||
      // Always attack if we are a bot or in an HvN game
      this.player.type() === PlayerType.Bot ||
      this.game.config().gameConfig().playerTeams === HumansVsNations
    ) {
      return true;
    }

    // Prevent attacking of humans on lower difficulties
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy && this.random.chance(2)) {
      return false;
    }
    if (difficulty === Difficulty.Medium && this.random.chance(4)) {
      return false;
    }
    return true;
  }

  private sendLandAttack(target: Player | TerraNullius) {
    const maxPopulation = this.game.config().maxPopulation(this.player);
    const botWithStructures =
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      target.units().some((u) => Structures.has(u.type()));
    // Use the expand ratio when attacking a bot that owns structures — we need to
    // recapture those structures ASAP, even before reaching the normal reserve.
    const useReserve = target.isPlayer() && !botWithStructures;
    const reserveRatio = useReserve ? this.reserveRatio : this.expandRatio;
    const targetPopulation = maxPopulation * reserveRatio;

    let population;
    if (
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      this.player.type() !== PlayerType.Bot
    ) {
      population = this.calculateBotAttackPopulation(
        target,
        this.player.population() -
          targetPopulation -
          this.botAttackPopulationSent,
      );
    } else {
      population = this.player.population() - targetPopulation;
    }

    if (population < 1) {
      return;
    }

    if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
      if (this.emojiBehavior === undefined) throw new Error("not initialized");
      this.emojiBehavior.maybeSendAttackEmoji(target);
    }

    this.game.addExecution(
      new AttackExecution(
        population,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );
  }

  private sendBoatAttack(target: Player) {
    const closest = closestTwoTiles(
      this.game,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isVoidShore(t),
      ),
      Array.from(target.borderTiles()).filter((t) => this.game.isVoidShore(t)),
    );
    if (closest === null) {
      return;
    }

    if (!canBuildAssaultShuttle(this.game, this.player, closest.y)) {
      return;
    }

    let population;
    if (target.type() === PlayerType.Bot) {
      population = this.calculateBotAttackPopulation(
        target,
        this.player.population() / 5,
      );
    } else {
      population = this.player.population() / 5;
    }

    if (population < 1) {
      return;
    }

    if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
      if (this.emojiBehavior === undefined) throw new Error("not initialized");
      this.emojiBehavior.maybeSendAttackEmoji(target);
    }

    this.game.addExecution(
      new AssaultShuttleExecution(this.player, closest.y, population),
    );
  }

  private calculateBotAttackPopulation(
    target: Player,
    maxPopulation: number,
  ): number {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) {
      this.botAttackPopulationSent += maxPopulation;
      return maxPopulation;
    }
    let population = target.population() * 4;

    // Don't send more population than maxPopulation (Keep reserve)
    if (population > maxPopulation) {
      // If we haven't enough population left to do a big enough bot attack, skip it
      if (maxPopulation < target.population() * 2) {
        population = 0;
      } else {
        population = maxPopulation;
      }
    }
    this.botAttackPopulationSent += population;
    return population;
  }

  private donatePopulation(): boolean {
    // Only donate in team games
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return false;
    }

    // Don't donate in public games (To balance HvN)
    if (this.game.config().gameConfig().gameType === GameType.Public) {
      return false;
    }

    // Check if donating population is allowed
    if (this.game.config().donatePopulation() === false) {
      return false;
    }

    // Don't donate if the game has a winner
    if (this.game.getWinner() !== null) {
      return false;
    }

    // Skip donating based on difficulty
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // Easy nations don't donate
        return false;
      case Difficulty.Medium:
        // Medium nations donate 25% of the time
        if (!this.random.chance(4)) {
          return false;
        }
        break;
      case Difficulty.Hard:
        // Hard nations donate 50% of the time
        if (!this.random.chance(2)) {
          return false;
        }
        break;
      case Difficulty.Impossible:
        // Impossible nations always try to donate
        break;
      default:
        assertNever(difficulty);
    }

    // Find teammates who are currently in combat
    const teammates = this.game
      .players()
      .filter((p) => this.player.isOnSameTeam(p))
      .filter(
        (p) => p.incomingAttacks().length > 0 || p.outgoingAttacks().length > 0,
      );

    if (teammates.length === 0) {
      return false;
    }

    // Find teammate with lowest population percentage (population / maxPopulation)
    const teammatesWithTroopPercentage = teammates
      .map((teammate) => {
        const maxPopulation = this.game.config().maxPopulation(teammate);
        const troopPercentage =
          teammate.population() / Math.max(maxPopulation, 1);
        return { teammate, troopPercentage };
      })
      .sort((a, b) => a.troopPercentage - b.troopPercentage);

    // Try to donate to teammates in order of lowest population percentage
    let selectedTeammate: Player | null = null;
    for (const entry of teammatesWithTroopPercentage) {
      if (this.player.canDonatePopulation(entry.teammate)) {
        selectedTeammate = entry.teammate;
        break;
      }
    }

    if (selectedTeammate === null) {
      return false;
    }

    // Donate a portion of our population (keeping reserve)
    const maxPopulation = this.game.config().maxPopulation(this.player);
    const populationToKeep = maxPopulation * this.reserveRatio;
    const availablePopulation = this.player.population() - populationToKeep;

    if (availablePopulation < 1) {
      return false;
    }

    this.game.addExecution(
      new DonatePopulationExecution(
        this.player,
        selectedTeammate.id(),
        availablePopulation,
      ),
    );

    return true;
  }
}
