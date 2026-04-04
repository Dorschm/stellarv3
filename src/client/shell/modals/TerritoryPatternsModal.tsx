import { useCallback, useState } from "react";
import type { Cosmetics } from "../../../core/CosmeticSchemas";
import type { UserMeResponse } from "../../../core/ApiSchemas";
import { UserSettings } from "../../../core/game/UserSettings";
import { fetchCosmetics, patternRelationship } from "../../Cosmetics";
import { getUserMe } from "../../Api";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function TerritoryPatternsModal() {
  const { showPage } = useNavigation();
  const [search, setSearch] = useState("");
  const [cosmetics, setCosmetics] = useState<Cosmetics | null>(null);
  const [userMe, setUserMe] = useState<UserMeResponse | false>(false);
  const [userSettings] = useState(() => new UserSettings());

  const onOpen = useCallback(async () => {
    const [cosmeticsData, auth] = await Promise.all([
      fetchCosmetics(),
      userAuth(),
    ]);
    setCosmetics(cosmeticsData);
    if (auth !== false) {
      const me = await getUserMe();
      setUserMe(me);
    }
  }, []);

  const onClose = useCallback(() => {
    setSearch("");
  }, []);

  const selectPattern = useCallback((patternName: string) => {
    userSettings.setSelectedPatternName(patternName);
    window.dispatchEvent(new CustomEvent("show-message", {
      detail: { message: `Pattern selected: ${patternName}`, color: "green", duration: 1500 },
    }));
    document.dispatchEvent(new CustomEvent("event:user-settings-changed:pattern"));
    showPage("page-play");
  }, [userSettings, showPage]);

  const ownedPatterns = cosmetics
    ? Object.values(cosmetics.patterns).filter((p) => {
        if (patternRelationship(p, null, userMe, null) !== "owned") return false;
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
    : [];

  return (
    <ModalPage pageId="territory-patterns-modal" onOpen={onOpen} onClose={onClose}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("territory_patterns.title")}</h2>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translateText("territory_patterns.search")}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50 w-40"
            />
            <button onClick={() => showPage("page-item-store")} className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-medium hover:bg-blue-600/30 transition-colors">
              {translateText("main.store")}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {/* None option */}
          <button onClick={() => selectPattern("")} className="mb-3 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors text-sm w-full text-left">
            {translateText("territory_patterns.none")}
          </button>

          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {ownedPatterns.map((pattern) => (
              <button
                key={pattern.name}
                onClick={() => selectPattern(pattern.name)}
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-white/10 border border-blue-500/50 hover:bg-white/15 transition-colors"
              >
                <div className="w-12 h-12 rounded bg-white/10" />
                <span className="text-xs text-white/70 truncate w-full text-center">{pattern.name}</span>
              </button>
            ))}
          </div>

          {ownedPatterns.length === 0 && (
            <div className="text-center text-white/40 py-8">
              <p>{translateText("territory_patterns.no_patterns")}</p>
              <button onClick={() => showPage("page-item-store")} className="mt-3 px-4 py-2 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-sm hover:bg-blue-600/30 transition-colors">
                {translateText("territory_patterns.visit_store")}
              </button>
            </div>
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
