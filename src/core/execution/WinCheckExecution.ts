import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  Player,
  PlayerType,
  RankedType,
  Team,
  WinCondition,
} from "../game/Game";

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  // Hard time limit (in seconds) to force a winner before the server's
  // maxGameDuration hard kill. 170mins (10 mins before 3hrs)
  private static readonly HARD_TIME_LIMIT_SECONDS = 170 * 60;

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  /**
   * Returns true when the configured `winCondition` for this run is
   * `Elimination`. The default in {@link DefaultConfig} is `Domination`
   * so that existing public lobbies and replays that pre-date the
   * `winCondition` field are not affected; GDD-aligned Stellar mode opts
   * into `Elimination` via the explicit `gameConfig.winCondition` field.
   */
  private isEliminationMode(): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    return this.mg.config().winCondition() === WinCondition.Elimination;
  }

  /**
   * Returns the elapsed seconds since the spawn phase ended, used by both
   * the per-game `maxTimerValue` cap and the global 170-min hard limit.
   */
  private elapsedSeconds(): number {
    if (this.mg === null) throw new Error("Not initialized");
    return (this.mg.ticks() - this.mg.config().numSpawnPhaseTurns()) / 10;
  }

  /**
   * Returns true if either the per-game timer or the global 170-min hard
   * limit has expired. Used as the tie-breaker fallback for elimination
   * mode (see GDD §1, §12 — "if no one is eliminated, the timer forces
   * a most-tiles win").
   */
  private timerExpired(): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    const elapsed = this.elapsedSeconds();
    const maxTimerValue = this.mg.config().gameConfig().maxTimerValue;
    if (maxTimerValue !== undefined && elapsed - maxTimerValue * 60 >= 0) {
      return true;
    }
    return elapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS;
  }

  /**
   * Declares `winner` and shuts the executor off. Centralized so both the
   * elimination and domination paths populate the same fields (incl. the
   * GDD §10 RunScore via `Game.setWinner` -> `Game.runScore`).
   */
  private declareWinner(winner: Player | Team): void {
    if (this.mg === null) throw new Error("Not initialized");
    this.mg.setWinner(winner, this.mg.stats().stats());
    if (typeof winner === "string") {
      console.log(`${winner} has won the game`);
    } else {
      console.log(`${winner.name()} has won the game`);
    }
    this.active = false;
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const players = this.mg.players();
    if (players.length === 0) {
      return;
    }

    if (this.mg.config().gameConfig().rankedType === RankedType.OneVOne) {
      const humans = players.filter(
        (p) => p.type() === PlayerType.Human && !p.isDisconnected(),
      );
      if (humans.length === 1) {
        this.declareWinner(humans[0]);
        return;
      }
    }

    if (this.isEliminationMode()) {
      this.checkWinnerEliminationFFA(players);
      return;
    }

    this.checkWinnerDominationFFA(players);
  }

  /**
   * GDD §1, §12 — last-faction-standing win condition for FFA. Triggers
   * as soon as exactly one player has any owned tiles (TerraNullius does
   * not count, since it isn't in `players()`). Falls back to "most tiles
   * wins" if the per-game / 170-min hard timer expires before the field
   * has narrowed.
   */
  private checkWinnerEliminationFFA(players: Player[]): void {
    if (this.mg === null) throw new Error("Not initialized");
    // Guard against the spawn-phase race: WinCheck first fires shortly
    // after `numSpawnPhaseTurns`, while some registered players may still
    // be resolving their `SpawnExecution`. If we ran the elimination check
    // here we could declare the first player to land on the board as the
    // winner against opponents who simply haven't been placed yet. Skip
    // the entire tick until every registered player has spawned.
    if (players.some((p) => !p.hasSpawned())) {
      return;
    }
    // Only consider factions still on the board. A player with 0 tiles is
    // either dead or hasn't spawned yet — neither counts as "alive in the
    // run" for elimination.
    const alive = players.filter((p) => p.numTilesOwned() > 0);
    if (alive.length === 1) {
      this.declareWinner(alive[0]);
      return;
    }
    if (alive.length === 0) {
      // Edge case — everyone died on the same tick. Fall through to the
      // timer fallback so we don't deadlock the run.
      if (this.timerExpired()) {
        const max = players
          .slice()
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
        this.declareWinner(max);
      }
      return;
    }
    // Multiple factions still alive — only resolve via the timer fallback.
    if (this.timerExpired()) {
      const max = alive
        .slice()
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
      this.declareWinner(max);
    }
  }

  /**
   * Legacy OpenFront 80%/95% threshold path. Preserved verbatim so older
   * lobbies that opt into `WinCondition.Domination` continue to behave
   * exactly as before.
   */
  private checkWinnerDominationFFA(players: Player[]): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = players
      .slice()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    const max = sorted[0];
    const numTilesWithoutFallout =
      this.mg.numSectorTiles() - this.mg.numTilesWithFallout();
    if (
      (max.numTilesOwned() / numTilesWithoutFallout) * 100 >
        this.mg.config().percentageTilesOwnedToWin() ||
      this.timerExpired()
    ) {
      this.declareWinner(max);
    }
  }

  checkWinnerTeam(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }
    if (teamToTiles.size === 0) {
      return;
    }

    if (this.isEliminationMode()) {
      this.checkWinnerEliminationTeam(teamToTiles);
      return;
    }

    this.checkWinnerDominationTeam(teamToTiles);
  }

  /**
   * GDD §1, §12 — team elimination. A team wins as soon as it is the only
   * non-Bot team with any owned tiles. The Bot team is excluded from the
   * winner candidates (matching legacy behavior) but is *not* counted as
   * "alive" for the purposes of triggering elimination, so a single
   * surviving human team beats the surviving Bot team.
   */
  private checkWinnerEliminationTeam(teamToTiles: Map<Team, number>): void {
    if (this.mg === null) throw new Error("Not initialized");
    // Symmetric guard with `checkWinnerEliminationFFA`: hold off declaring
    // a team-elimination win while any registered player is still mid-
    // spawn, otherwise teams whose members haven't yet been placed could
    // be wrongly eliminated.
    if (this.mg.players().some((p) => !p.hasSpawned())) {
      return;
    }
    const aliveNonBot: Team[] = [];
    for (const [team, tiles] of teamToTiles.entries()) {
      if (tiles <= 0) continue;
      if (team === ColoredTeams.Bot) continue;
      aliveNonBot.push(team);
    }
    if (aliveNonBot.length === 1) {
      this.declareWinner(aliveNonBot[0]);
      return;
    }
    if (aliveNonBot.length === 0) {
      // No human team has any tiles left — fall through to the timer
      // fallback to avoid stalling the run.
      if (this.timerExpired()) {
        const sorted = Array.from(teamToTiles.entries())
          .filter(([t]) => t !== ColoredTeams.Bot)
          .sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
          this.declareWinner(sorted[0][0]);
        }
      }
      return;
    }
    if (this.timerExpired()) {
      const sorted = Array.from(teamToTiles.entries())
        .filter(([t]) => t !== ColoredTeams.Bot)
        .sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        this.declareWinner(sorted[0][0]);
      }
    }
  }

  /**
   * Legacy 95% threshold path for team mode, preserved unchanged for the
   * `Domination` opt-in. The elimination path lives in
   * {@link checkWinnerEliminationTeam}.
   */
  private checkWinnerDominationTeam(teamToTiles: Map<Team, number>): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = Array.from(teamToTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    const numTilesWithoutFallout =
      this.mg.numSectorTiles() - this.mg.numTilesWithFallout();
    const percentage = (max[1] / numTilesWithoutFallout) * 100;
    if (
      percentage > this.mg.config().percentageTilesOwnedToWin() ||
      this.timerExpired()
    ) {
      if (max[0] === ColoredTeams.Bot) return;
      this.declareWinner(max[0]);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
