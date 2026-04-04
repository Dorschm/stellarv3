import { useCallback, useRef, useState } from "react";
import { getApiBase } from "../../Api";
import { translateText } from "../../Utils";
import { LoadingSpinner, ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  publicId?: string;
}

interface ClanEntry {
  rank: number;
  name: string;
  score: number;
  members: number;
}

export function LeaderboardModal() {
  const { showPage } = useNavigation();
  const [activeTab, setActiveTab] = useState<"players" | "clans">("players");
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [clans, setClans] = useState<ClanEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const loadTokenRef = useRef(0);

  const loadPlayers = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/leaderboard/players`);
      if (token !== loadTokenRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setPlayers(
          (data.players ?? data ?? []).map((p: any, i: number) => ({
            rank: i + 1,
            username: p.username ?? p.name ?? "Unknown",
            score: p.score ?? p.elo ?? 0,
            publicId: p.publicId,
          })),
        );
      }
    } catch {
      // ignore
    }
    if (token === loadTokenRef.current) setIsLoading(false);
  }, []);

  const loadClans = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/leaderboard/clans`);
      if (token !== loadTokenRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setClans(
          (data.clans ?? data ?? []).map((c: any, i: number) => ({
            rank: i + 1,
            name: c.name ?? c.tag ?? "Unknown",
            score: c.score ?? 0,
            members: c.members ?? 0,
          })),
        );
      }
    } catch {
      // ignore
    }
    if (token === loadTokenRef.current) setIsLoading(false);
  }, []);

  const onOpen = useCallback(() => {
    if (activeTab === "players") loadPlayers();
    else loadClans();
  }, [activeTab, loadPlayers, loadClans]);

  const handleTabChange = useCallback(
    (tab: "players" | "clans") => {
      setActiveTab(tab);
      if (tab === "players") loadPlayers();
      else loadClans();
    },
    [loadPlayers, loadClans],
  );

  return (
    <ModalPage pageId="page-leaderboard" onOpen={onOpen}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.leaderboard")}</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-4">
          <button onClick={() => handleTabChange("players")} className={`px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors ${activeTab === "players" ? "text-blue-400 border-b-2 border-blue-400" : "text-white/50 hover:text-white/80"}`}>
            {translateText("leaderboard.players")}
          </button>
          <button onClick={() => handleTabChange("clans")} className={`px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors ${activeTab === "clans" ? "text-blue-400 border-b-2 border-blue-400" : "text-white/50 hover:text-white/80"}`}>
            {translateText("leaderboard.clans")}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {isLoading ? (
            <LoadingSpinner message={translateText("leaderboard.loading")} />
          ) : activeTab === "players" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase tracking-wider text-left border-b border-white/10">
                  <th className="py-2 pl-4 w-16">#</th>
                  <th className="py-2">{translateText("leaderboard.player")}</th>
                  <th className="py-2 pr-4 text-right">{translateText("leaderboard.score")}</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.rank} className="hover:bg-white/5 transition-colors border-b border-white/5">
                    <td className="py-2.5 pl-4 text-white/40 font-mono">{p.rank}</td>
                    <td className="py-2.5 text-white">{p.username}</td>
                    <td className="py-2.5 pr-4 text-right text-white/70 font-mono">{p.score.toLocaleString()}</td>
                  </tr>
                ))}
                {players.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-white/40 py-8">{translateText("leaderboard.no_data")}</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/40 text-xs uppercase tracking-wider text-left border-b border-white/10">
                  <th className="py-2 pl-4 w-16">#</th>
                  <th className="py-2">{translateText("leaderboard.clan")}</th>
                  <th className="py-2 text-right">{translateText("leaderboard.members")}</th>
                  <th className="py-2 pr-4 text-right">{translateText("leaderboard.score")}</th>
                </tr>
              </thead>
              <tbody>
                {clans.map((c) => (
                  <tr key={c.rank} className="hover:bg-white/5 transition-colors border-b border-white/5">
                    <td className="py-2.5 pl-4 text-white/40 font-mono">{c.rank}</td>
                    <td className="py-2.5 text-white">{c.name}</td>
                    <td className="py-2.5 text-right text-white/50">{c.members}</td>
                    <td className="py-2.5 pr-4 text-right text-white/70 font-mono">{c.score.toLocaleString()}</td>
                  </tr>
                ))}
                {clans.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-white/40 py-8">{translateText("leaderboard.no_data")}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
