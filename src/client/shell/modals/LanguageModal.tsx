import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";
import { LangSelector } from "../components/LangSelector";

export function LanguageModal() {
  const { showPage } = useNavigation();

  return (
    <ModalPage pageId="page-language">
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.language")}</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col items-center justify-center">
          <LangSelector />
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
