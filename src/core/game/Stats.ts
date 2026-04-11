import { AllPlayersStats } from "../Schemas";
import { NukeType, OtherUnitType, PlayerStats } from "../StatsSchemas";
import { Player, RunScore, TerraNullius, WinCondition } from "./Game";
import { SectorMap } from "./SectorMap";

export interface Stats {
  getPlayerStats(player: Player): PlayerStats | null;
  stats(): AllPlayersStats;

  /**
   * Records that `player` is now known to own at least one tile in
   * `sectorId`. Idempotent — repeat calls for the same (player, sector)
   * pair are no-ops. Used by `runScore()` to compute the GDD `Planets
   * Conquered` metric (distinct sectors ever owned).
   *
   * Sector ID `0` represents "no sector" and is ignored. See
   * {@link SectorMap.sectorOf}.
   */
  recordSectorConquest(player: Player, sectorId: number): void;

  /**
   * Records the absolute tick at which a player was first eliminated, in
   * call order. The first call assigns rank 1, the second rank 2, etc.,
   * matching the GDD requirement that "last eliminated = highest rank".
   * Idempotent on `player`. Wired in via {@link playerKilled}.
   */
  recordEliminationOrder(player: Player): number;

  /**
   * Builds a per-run score snapshot suitable for serializing into the win
   * event. `tick` is the current game tick (used to compute survival time
   * for survivors). Survivors are assigned an elimination rank above all
   * eliminated players in the order they appear in `players`.
   *
   * Returns `null` if a SectorMap has not been registered (e.g., in unit
   * tests that bypass `GameImpl`); callers should treat that as "no score".
   */
  runScore(
    players: Player[],
    tick: number,
    winCondition: WinCondition,
  ): RunScore | null;

  /**
   * Wires the SectorMap into the stats tracker. Called once from
   * GameImpl during construction. Stats methods that need to map a
   * `TileRef` -> sector go through this reference rather than re-deriving
   * the partition.
   */
  setSectorMap(sectorMap: SectorMap): void;

  numClusterWarheadsLaunched(): bigint;

  // Player attacks target
  attack(
    player: Player,
    target: Player | TerraNullius,
    population: number | bigint,
  ): void;

  // Player cancels attack on target
  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    population: number | bigint,
  ): void;

  // Player betrays another player
  betray(player: Player): void;

  // Time between lobby creation and game start (ms)
  lobbyFillTime(fillTimeMs: number): void;

  // Player sends a trade freighter to target
  freighterSendTrade(player: Player, target: Player): void;

  // Player's trade freighter arrives at target, both players earn credits
  freighterArriveTrade(
    player: Player,
    target: Player,
    credits: number | bigint,
  ): void;

  // Player's trade freighter, captured from target, arrives. Player earns credits.
  freighterCapturedTrade(
    player: Player,
    target: Player,
    credits: number | bigint,
  ): void;

  // Player destroys target's trade freighter
  freighterDestroyTrade(player: Player, target: Player): void;

  // Player sends an assault shuttle to target with population
  shuttleSendPopulation(
    player: Player,
    target: Player | TerraNullius,
    population: number | bigint,
  ): void;

  // Player's assault shuttle arrives at target with population
  shuttleArrivePopulation(
    player: Player,
    target: Player | TerraNullius,
    population: number | bigint,
  ): void;

  // Player destroys target's assault shuttle with population
  shuttleDestroyPopulation(
    player: Player,
    target: Player,
    population: number | bigint,
  ): void;

  // Player launches bomb at target
  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void;

  // Player's bomb lands at target
  bombLand(player: Player, target: Player | TerraNullius, type: NukeType): void;

  // Player's point defense intercepts a bomb from attacker
  bombIntercept(player: Player, type: NukeType, count: number | bigint): void;

  // Player earns credits from conquering tiles or capturing trade freighters
  creditsWar(player: Player, captured: Player, credits: number | bigint): void;

  // Player earns credits from workers
  creditsWork(player: Player, credits: number | bigint): void;

  // Player builds a unit of type
  unitBuild(player: Player, type: OtherUnitType): void;

  // Player captures a unit of type
  unitCapture(player: Player, type: OtherUnitType): void;

  // Player upgrades a unit of type
  unitUpgrade(player: Player, type: OtherUnitType): void;

  // Player destroys a unit of type
  unitDestroy(player: Player, type: OtherUnitType): void;

  // Player loses a unit of type
  unitLose(player: Player, type: OtherUnitType): void;

  // player was killed (0 tiles)
  playerKilled(player: Player, tick: number): void;

  // Player's frigate arrives at any trade hub, generating credits
  frigateSelfTrade(player: Player, credits: number | bigint): void;

  // Another player's frigate arrives at own trade hub
  frigateExternalTrade(player: Player, credits: number | bigint);
}
