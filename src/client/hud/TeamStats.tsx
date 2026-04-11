import React, { useEffect, useState } from "react";
import { GameMode, Team, UnitType } from "../../core/game/Game";
import { PlayerView } from "../../core/game/GameView";
import {
  formatPercentage,
  renderNumber,
  renderPopulation,
  translateText,
} from "../Utils";
import { useGameTick } from "./useGameTick";

interface TeamEntry {
  teamName: string;
  isMyTeam: boolean;
  totalScoreStr: string;
  totalGold: string;
  totalMaxPopulation: string;
  totalSAMs: string;
  totalLaunchers: string;
  totalWarShips: string;
  totalCities: string;
  totalScoreSort: number;
  players: PlayerView[];
}

interface TeamStatsProps {
  visible: boolean;
}

function TeamStats({ visible }: TeamStatsProps): React.JSX.Element {
  const { gameView, tick } = useGameTick(1000);
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [showUnits, setShowUnits] = useState(false);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [shownOnInit, setShownOnInit] = useState(false);

  useEffect(() => {
    if (!gameView) return;

    // Only show in team mode
    if (gameView.config().gameConfig().gameMode !== GameMode.Team) {
      return;
    }

    // Auto-show after spawn phase
    if (!shownOnInit && !gameView.inSpawnPhase()) {
      setShownOnInit(true);
    }

    if (!visible) return;

    updateTeamStats();
  }, [visible, gameView, tick, shownOnInit]);

  const updateTeamStats = () => {
    if (!gameView) return;

    const players = gameView.playerViews();
    const grouped: Record<string, PlayerView[]> = {};

    // Get my team
    let currentMyTeam = myTeam;
    if (currentMyTeam === null) {
      const myPlayer = gameView.myPlayer();
      currentMyTeam = myPlayer?.team() ?? null;
      if (currentMyTeam) {
        setMyTeam(currentMyTeam);
      }
    }

    for (const player of players) {
      const rawTeam = player.team();
      if (rawTeam === null) continue;
      const key = String(rawTeam);
      grouped[key] ??= [];
      grouped[key].push(player);
    }

    const teamsData = Object.entries(grouped)
      .map(([rawTeamStr, teamPlayers]) => {
        const rawTeam = rawTeamStr as unknown as Team;
        const key = `team_colors.${String(rawTeam).toLowerCase()}`;
        const translated = translateText(key);
        const teamName = translated !== key ? translated : String(rawTeam);

        let totalGold = 0n;
        let totalMaxPopulation = 0;
        let totalScoreSort = 0;
        let totalSAMs = 0;
        let totalLaunchers = 0;
        let totalWarShips = 0;
        let totalCities = 0;

        for (const p of teamPlayers) {
          if (p.isAlive()) {
            totalMaxPopulation += gameView.config().maxPopulation(p);
            totalGold += p.credits();
            totalScoreSort += p.numTilesOwned();
            totalLaunchers += p.totalUnitLevels(UnitType.OrbitalStrikePlatform);
            totalSAMs += p.totalUnitLevels(UnitType.PointDefenseArray);
            totalWarShips += p.totalUnitLevels(UnitType.Battlecruiser);
            totalCities += p.totalUnitLevels(UnitType.Colony);
          }
        }

        const numTilesWithoutFallout =
          gameView.numSectorTiles() - gameView.numTilesWithFallout();
        const totalScorePercent = totalScoreSort / numTilesWithoutFallout;

        return {
          teamName,
          isMyTeam: rawTeam === currentMyTeam,
          totalScoreStr: formatPercentage(totalScorePercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalMaxPopulation: renderPopulation(totalMaxPopulation),
          players: teamPlayers,
          totalLaunchers: renderNumber(totalLaunchers),
          totalSAMs: renderNumber(totalSAMs),
          totalWarShips: renderNumber(totalWarShips),
          totalCities: renderNumber(totalCities),
        };
      })
      .sort((a, b) => b.totalScoreSort - a.totalScoreSort);

    setTeams(teamsData);
  };

  if (!visible) return <></>;

  return (
    <div
      className="max-h-[30vh] overflow-x-hidden overflow-y-auto grid bg-slate-800/85 w-full text-white text-xs md:text-sm mt-2 rounded-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${showUnits ? 5 : 4}, 1fr)`,
        }}
      >
        {/* Header */}
        <div className="contents font-bold bg-slate-700/60">
          <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
            {translateText("leaderboard.team")}
          </div>
          {showUnits ? (
            <>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.launchers")}
              </div>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.sams")}
              </div>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.warships")}
              </div>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.cities")}
              </div>
            </>
          ) : (
            <>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.owned")}
              </div>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.gold")}
              </div>
              <div className="p-1.5 md:p-2.5 text-center border-b border-slate-500">
                {translateText("leaderboard.maxpopulation")}
              </div>
            </>
          )}
        </div>

        {/* Data rows */}
        {teams.map((team) =>
          showUnits ? (
            <div
              key={team.teamName}
              className={`contents hover:bg-slate-600/60 text-center cursor-pointer ${
                team.isMyTeam ? "font-bold" : ""
              }`}
            >
              <div className="py-1.5 border-b border-slate-500">
                {team.teamName}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalLaunchers}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalSAMs}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalWarShips}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalCities}
              </div>
            </div>
          ) : (
            <div
              key={team.teamName}
              className={`contents hover:bg-slate-600/60 text-center cursor-pointer ${
                team.isMyTeam ? "font-bold" : ""
              }`}
            >
              <div className="py-1.5 border-b border-slate-500">
                {team.teamName}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalScoreStr}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalGold}
              </div>
              <div className="py-1.5 border-b border-slate-500">
                {team.totalMaxPopulation}
              </div>
            </div>
          ),
        )}
      </div>

      <button
        className="team-stats-button"
        aria-pressed={showUnits}
        onClick={() => setShowUnits(!showUnits)}
      >
        {showUnits
          ? translateText("leaderboard.show_control")
          : translateText("leaderboard.show_units")}
      </button>
    </div>
  );
}

export { TeamStats };
export default TeamStats;
