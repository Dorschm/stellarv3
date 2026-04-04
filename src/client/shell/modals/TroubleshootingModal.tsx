import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function TroubleshootingModal() {
  const { showPage } = useNavigation();

  const tips = [
    { title: translateText("troubleshooting.tip1_title"), desc: translateText("troubleshooting.tip1_desc") },
    { title: translateText("troubleshooting.tip2_title"), desc: translateText("troubleshooting.tip2_desc") },
    { title: translateText("troubleshooting.tip3_title"), desc: translateText("troubleshooting.tip3_desc") },
    { title: translateText("troubleshooting.tip4_title"), desc: translateText("troubleshooting.tip4_desc") },
    { title: translateText("troubleshooting.tip5_title"), desc: translateText("troubleshooting.tip5_desc") },
  ];

  return (
    <ModalPage pageId="page-troubleshooting">
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-help")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.troubleshooting")}</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {tips.map((tip, i) => (
            <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/10">
              <h3 className="text-white font-bold text-sm mb-1">{tip.title}</h3>
              <p className="text-white/60 text-sm">{tip.desc}</p>
            </div>
          ))}

          <div className="mt-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <p className="text-white/70 text-sm">
              {translateText("troubleshooting.still_having_issues")}
            </p>
            <a
              href="https://discord.gg/openfront"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 px-4 py-2 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] transition-colors text-white text-sm font-medium"
            >
              {translateText("troubleshooting.join_discord")}
            </a>
          </div>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
