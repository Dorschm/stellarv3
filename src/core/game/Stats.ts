import { AllPlayersStats } from "../Schemas";
import { NukeType, OtherUnitType, PlayerStats } from "../StatsSchemas";
import { Player, TerraNullius } from "./Game";

export interface Stats {
  getPlayerStats(player: Player): PlayerStats | null;
  stats(): AllPlayersStats;

  numClusterWarheadsLaunched(): bigint;

  // Player attacks target
  attack(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player cancels attack on target
  attackCancel(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player betrays another player
  betray(player: Player): void;

  // Time between lobby creation and game start (ms)
  lobbyFillTime(fillTimeMs: number): void;

  // Player sends a trade ship to target
  freighterSendTrade(player: Player, target: Player): void;

  // Player's trade ship arrives at target, both players earn gold
  freighterArriveTrade(
    player: Player,
    target: Player,
    gold: number | bigint,
  ): void;

  // Player's trade ship, captured from target, arrives. Player earns gold.
  freighterCapturedTrade(
    player: Player,
    target: Player,
    gold: number | bigint,
  ): void;

  // Player destroys target's trade ship
  freighterDestroyTrade(player: Player, target: Player): void;

  // Player sends a transport ship to target with troops
  shuttleSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player's transport ship arrives at target with troops
  shuttleArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player destroys target's transport ship with troops
  shuttleDestroyTroops(
    player: Player,
    target: Player,
    troops: number | bigint,
  ): void;

  // Player launches bomb at target
  bombLaunch(
    player: Player,
    target: Player | TerraNullius,
    type: NukeType,
  ): void;

  // Player's bomb lands at target
  bombLand(player: Player, target: Player | TerraNullius, type: NukeType): void;

  // Player's SAM intercepts a bomb from attacker
  bombIntercept(player: Player, type: NukeType, count: number | bigint): void;

  // Player earns gold from conquering tiles or trade ships from captured
  creditsWar(player: Player, captured: Player, gold: number | bigint): void;

  // Player earns gold from workers
  creditsWork(player: Player, gold: number | bigint): void;

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

  // Player's train arrives at any station, generating gold
  frigateSelfTrade(player: Player, gold: number | bigint): void;

  // Another player's train arrives at own station
  frigateExternalTrade(player: Player, goldPlayer: number | bigint);
}
