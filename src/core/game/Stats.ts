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

  // Player sends an assault shuttle to target with troops
  shuttleSendTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player's assault shuttle arrives at target with troops
  shuttleArriveTroops(
    player: Player,
    target: Player | TerraNullius,
    troops: number | bigint,
  ): void;

  // Player destroys target's assault shuttle with troops
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
