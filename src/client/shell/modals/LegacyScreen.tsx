import { useState } from "react";
import { PersistedRunScore } from "../../../core/game/Game";
import { loadRunHistory } from "../../RunHistory";
import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function LegacyScreen() {
  const { showPage } = useNavigation();
  const [runs] = useState<PersistedRunScore[]>(() =>
    loadRunHistory().slice().reverse(),
  );

  return (
    <ModalPage pageId="page-legacy">
      <ModalContainer>
        <div className="p-4 lg:p-6 text-white flex flex-col gap-4 h-full overflow-y-auto">
          <h2 className="text-xl font-bold">
            {translateText("legacy.title") || "Legacy"}
          </h2>

          {runs.length === 0 ? (
            <p className="text-white/60 text-sm">
              {translateText("legacy.no_runs") ||
                "No past runs yet. Play a game to see your history here."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left border-b border-white/30">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Map</th>
                    <th className="py-2 pr-3 text-right">Planets</th>
                    <th className="py-2 pr-3 text-right">Systems</th>
                    <th className="py-2 pr-3 text-right">Survived</th>
                    <th className="py-2 text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run, i) => {
                    const myScore = run.players[0];
                    return (
                      <tr
                        key={i}
                        className={
                          run.result === "win"
                            ? "bg-green-900/20"
                            : "bg-red-900/10"
                        }
                      >
                        <td className="py-1.5 pr-3 text-white/70">
                          {new Date(run.date).toLocaleDateString()}
                        </td>
                        <td className="py-1.5 pr-3">{run.mapName}</td>
                        <td className="py-1.5 pr-3 text-right">
                          {myScore?.planetsConquered ?? "-"}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {myScore?.systemsControlled ?? "-"}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {myScore
                            ? `${Math.round(myScore.survivalTicks / 10)}s`
                            : "-"}
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          <span
                            className={
                              run.result === "win"
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {run.result === "win" ? "Victory" : "Defeat"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-auto">
            <button
              onClick={() => showPage("page-play")}
              className="w-full py-2 px-4 text-white/60 hover:text-white text-sm transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
