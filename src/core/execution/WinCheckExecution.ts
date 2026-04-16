import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  Player,
  PlayerID,
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

  // GDD §12 — a player who owns tiles but has zero population is dead in
  // practice (can't attack, build, or expand). To avoid false positives
  // from momentary dips (shuttle launches, trade payloads), only eliminate
  // after the pop has been at zero for this many consecutive game ticks.
  // 50 ticks = 5 seconds at the 10 tick/s sim rate.
  private static readonly ZERO_POP_GRACE_TICKS = 50;

  // First tick at which we observed a surviving (tiles > 0) player/team
  // with zero population. Cleared as soon as population recovers.
  private playerZeroPopStart = new Map<PlayerID, number>();
  private teamZeroPopStart = new Map<Team, number>();

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

  /**
   * Returns the player whose owned tiles exceed
   * `percentageTilesOwnedToWin()` of the non-fallout sector total, or
   * null if no one is above the threshold. Shared by both the
   * legacy-Domination path and the new Elimination-mode shortcut so the
   * exact same denominator and percentage logic covers both.
   *
   * `candidates` is the pre-filtered set of players still eligible to win
   * (alive in elimination mode; unfiltered in legacy Domination). Passing
   * it in lets the caller decide whether to include bots/eliminated
   * players in the tile max without duplicating the iteration.
   */
  private dominantPlayer(candidates: Player[]): Player | null {
    if (this.mg === null) throw new Error("Not initialized");
    if (candidates.length === 0) return null;
    const max = candidates
      .slice()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
    const numTilesWithoutFallout =
      this.mg.numSectorTiles() - this.mg.numTilesWithFallout();
    if (numTilesWithoutFallout <= 0) return null;
    const pct = (max.numTilesOwned() / numTilesWithoutFallout) * 100;
    if (pct > this.mg.config().percentageTilesOwnedToWin()) {
      return max;
    }
    return null;
  }

  /**
   * Team-mode counterpart of {@link dominantPlayer}. Excludes the Bot
   * team from the winner pool so a bot-dominated run doesn't declare the
   * Bot team the winner, matching legacy Domination behavior.
   */
  private dominantTeam(teamToTiles: Map<Team, number>): Team | null {
    if (this.mg === null) throw new Error("Not initialized");
    const numTilesWithoutFallout =
      this.mg.numSectorTiles() - this.mg.numTilesWithFallout();
    if (numTilesWithoutFallout <= 0) return null;
    const sorted = Array.from(teamToTiles.entries())
      .filter(([t]) => t !== ColoredTeams.Bot)
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return null;
    const [team, tiles] = sorted[0];
    const pct = (tiles / numTilesWithoutFallout) * 100;
    if (pct > this.mg.config().percentageTilesOwnedToWin()) {
      return team;
    }
    return null;
  }

  /**
   * GDD §12 — a faction is considered alive in elimination mode only if it
   * still owns tiles AND has positive population. A player at exactly 0 pop
   * is granted `ZERO_POP_GRACE_TICKS` to recover (e.g. from their next
   * growth tick) before being treated as eliminated.
   */
  private isPlayerAlive(p: Player): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    if (p.numTilesOwned() <= 0) {
      this.playerZeroPopStart.delete(p.id());
      return false;
    }
    if (p.population() > 0) {
      this.playerZeroPopStart.delete(p.id());
      return true;
    }
    const start = this.playerZeroPopStart.get(p.id());
    if (start === undefined) {
      this.playerZeroPopStart.set(p.id(), this.mg.ticks());
      return true;
    }
    if (this.mg.ticks() - start < WinCheckExecution.ZERO_POP_GRACE_TICKS) {
      return true;
    }
    return false;
  }

  /**
   * Team-level counterpart of {@link isPlayerAlive}. A team with combined
   * population of 0 is given the same grace window before being dropped
   * from the elimination candidate set.
   */
  private isTeamAlivePopulation(team: Team, teamPop: number): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    if (teamPop > 0) {
      this.teamZeroPopStart.delete(team);
      return true;
    }
    const start = this.teamZeroPopStart.get(team);
    if (start === undefined) {
      this.teamZeroPopStart.set(team, this.mg.ticks());
      return true;
    }
    if (this.mg.ticks() - start < WinCheckExecution.ZERO_POP_GRACE_TICKS) {
      return true;
    }
    return false;
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
    // run" for elimination. GDD §12 also treats population = 0 as a loss,
    // but with a grace period to tolerate momentary dips (e.g. a shuttle
    // launch that drains the whole pop right before a growth tick).
    const alive = players.filter((p) => this.isPlayerAlive(p));
    if (alive.length === 1) {
      this.declareWinner(alive[0]);
      return;
    }
    // Domination shortcut — if one player already owns the configured
    // win-threshold fraction of sector tiles (default 80% for FFA), end
    // the game even if another faction is technically still alive with a
    // tiny holdout. Without this, a run could drag on indefinitely because
    // a single Nation squatting on its homeworld tile is enough to keep
    // `alive.length` at 2. Matches the user's expectation that "the game
    // ends when one nation controls 80% of the board" and aligns
    // Elimination mode with the legacy Domination behavior for the
    // dominant-player case.
    const dominator = this.dominantPlayer(alive);
    if (dominator !== null) {
      this.declareWinner(dominator);
      return;
    }
    if (alive.length === 0) {
      // Edge case — everyone died on the same tick (e.g. simultaneous
      // zero-pop eliminations). Waiting for `timerExpired()` would soft-
      // deadlock the run for minutes with no one able to act, so resolve
      // immediately by applying the most-tiles tie-break among the players
      // that still own any tiles. If nobody owns tiles either, fall through
      // to the raw player list so we always declare a winner.
      const candidates = players.filter((p) => p.numTilesOwned() > 0);
      const pool = candidates.length > 0 ? candidates : players;
      const max = pool
        .slice()
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
      this.declareWinner(max);
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
    const teamToPopulation = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
      teamToPopulation.set(
        team,
        (teamToPopulation.get(team) ?? 0) + player.population(),
      );
    }
    if (teamToTiles.size === 0) {
      return;
    }

    if (this.isEliminationMode()) {
      this.checkWinnerEliminationTeam(teamToTiles, teamToPopulation);
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
  private checkWinnerEliminationTeam(
    teamToTiles: Map<Team, number>,
    teamToPopulation: Map<Team, number>,
  ): void {
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
      if (!this.isTeamAlivePopulation(team, teamToPopulation.get(team) ?? 0)) {
        continue;
      }
      aliveNonBot.push(team);
    }
    // Drop stale grace-period entries for teams that no longer own tiles —
    // they've already been eliminated by the tiles check, and re-spawning
    // into the same team slot should get a fresh grace window.
    for (const team of Array.from(this.teamZeroPopStart.keys())) {
      if ((teamToTiles.get(team) ?? 0) <= 0) {
        this.teamZeroPopStart.delete(team);
      }
    }
    if (aliveNonBot.length === 1) {
      this.declareWinner(aliveNonBot[0]);
      return;
    }
    // Team-mode domination shortcut, mirroring the FFA path. Prevents
    // runs from hanging when a dominant team owns ≥threshold % of sector
    // tiles but another team (or an un-eliminated Bot slot) still holds
    // a single tile. The Bot team is excluded from winner candidates —
    // only non-Bot teams can win via this shortcut.
    const teamDominator = this.dominantTeam(teamToTiles);
    if (teamDominator !== null) {
      this.declareWinner(teamDominator);
      return;
    }
    if (aliveNonBot.length === 0) {
      // No non-bot team satisfies the alive predicate (e.g. all zero-pop
      // eliminations resolved on the same tick). Waiting for the timer
      // would soft-deadlock the run, so resolve immediately via the
      // most-tiles tie-break among non-bot teams.
      const sorted = Array.from(teamToTiles.entries())
        .filter(([t]) => t !== ColoredTeams.Bot)
        .sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) {
        this.declareWinner(sorted[0][0]);
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
