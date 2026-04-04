import { useCallback, useState } from "react";
import { getUserMe, hasLinkedAccount } from "../../Api";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function RankedModal() {
  const { showPage } = useNavigation();
  const [elo, setElo] = useState<number | string>("...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userMe, setUserMe] = useState<Awaited<ReturnType<typeof getUserMe>> | false>(false);

  const onOpen = useCallback(async () => {
    setElo("...");
    setErrorMessage(null);
    try {
      const response = await getUserMe();
      setUserMe(response);
      if (hasLinkedAccount(response) && response !== false) {
        setElo(response.player.leaderboard?.oneVone?.elo ?? translateText("matchmaking_modal.no_elo"));
      }
    } catch {
      setErrorMessage(translateText("map_component.error"));
      setElo(translateText("map_component.error"));
    }
  }, []);

  const handleRanked = useCallback(async () => {
    if ((await userAuth()) === false) {
      showPage("page-account");
      return;
    }
    document.dispatchEvent(new CustomEvent("open-matchmaking"));
    showPage("page-matchmaking");
  }, [showPage]);

  const renderCard = (title: string, subtitle: string, onClick: () => void) => (
    <button onClick={onClick} className="flex flex-col w-full h-28 sm:h-32 rounded-2xl bg-[color-mix(in_oklab,var(--frenchBlue)_70%,black)] border-0 transition-transform hover:scale-[1.02] active:scale-[0.98] p-6 items-center justify-center gap-3">
      <div className="flex flex-col items-center gap-1 text-center">
        <h3 className="text-lg sm:text-xl font-bold text-white uppercase tracking-widest leading-tight">{title}</h3>
        <p className="text-xs text-white/60 uppercase tracking-wider whitespace-pre-line leading-tight">{subtitle}</p>
      </div>
    </button>
  );

  const renderDisabledCard = (title: string, subtitle: string) => (
    <div className="flex flex-col w-full h-28 sm:h-32 overflow-hidden rounded-2xl bg-slate-900/40 backdrop-blur-md border-0 p-6 items-center justify-center gap-3 opacity-50 cursor-not-allowed">
      <div className="flex flex-col items-center gap-1 text-center">
        <h3 className="text-lg sm:text-xl font-bold text-white/60 uppercase tracking-widest leading-tight">{title}</h3>
        <p className="text-xs text-white/40 uppercase tracking-wider whitespace-pre-line leading-tight">{subtitle}</p>
      </div>
    </div>
  );

  return (
    <ModalPage pageId="page-ranked" onOpen={onOpen}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("mode_selector.ranked_title")}</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {renderCard(
              translateText("mode_selector.ranked_1v1_title"),
              errorMessage ?? (hasLinkedAccount(userMe) ? translateText("matchmaking_modal.elo", { elo }) : translateText("mode_selector.ranked_title")),
              handleRanked,
            )}
            {renderDisabledCard(translateText("mode_selector.ranked_2v2_title"), translateText("mode_selector.coming_soon"))}
            {renderDisabledCard(translateText("mode_selector.coming_soon"), "")}
            {renderDisabledCard(translateText("mode_selector.coming_soon"), "")}
          </div>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
