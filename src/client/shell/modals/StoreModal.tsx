import { useCallback, useEffect, useState } from "react";
import type { UserMeResponse } from "../../../core/ApiSchemas";
import type { Cosmetics, Pattern } from "../../../core/CosmeticSchemas";
import { UserSettings } from "../../../core/game/UserSettings";
import { fetchCosmetics, flagRelationship, handlePurchase, patternRelationship } from "../../Cosmetics";
import { getUserMe } from "../../Api";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function StoreModal() {
  const { showPage } = useNavigation();
  const [activeTab, setActiveTab] = useState<"patterns" | "flags">("patterns");
  const [cosmetics, setCosmetics] = useState<Cosmetics | null>(null);
  const [userMe, setUserMe] = useState<UserMeResponse | false>(false);
  const [userSettings] = useState(() => new UserSettings());

  const loadData = useCallback(async () => {
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

  // Listen for open-store-modal event
  useEffect(() => {
    const handler = () => {
      showPage("page-item-store");
    };
    document.addEventListener("open-store-modal", handler);
    return () => document.removeEventListener("open-store-modal", handler);
  }, [showPage]);

  const selectPattern = useCallback((pattern: Pattern, colorPaletteName?: string) => {
    const patternName = colorPaletteName
      ? `${pattern.name}:${colorPaletteName}`
      : pattern.name;
    userSettings.setSelectedPatternName(patternName);
    window.dispatchEvent(new CustomEvent("show-message", {
      detail: { message: `Selected: ${pattern.name}`, color: "green", duration: 2000 },
    }));
  }, [userSettings]);

  const selectFlag = useCallback((flagName: string) => {
    userSettings.setFlag(flagName);
    window.dispatchEvent(new CustomEvent("show-message", {
      detail: { message: `Selected: ${flagName}`, color: "green", duration: 2000 },
    }));
  }, [userSettings]);

  const patternList = cosmetics ? Object.values(cosmetics.patterns) : [];
  const flagList = cosmetics ? Object.values(cosmetics.flags) : [];

  return (
    <ModalPage pageId="page-item-store" onOpen={loadData}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.store")}</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-4">
          <button onClick={() => setActiveTab("patterns")} className={`px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors ${activeTab === "patterns" ? "text-blue-400 border-b-2 border-blue-400" : "text-white/50 hover:text-white/80"}`}>
            {translateText("store.patterns")}
          </button>
          <button onClick={() => setActiveTab("flags")} className={`px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors ${activeTab === "flags" ? "text-blue-400 border-b-2 border-blue-400" : "text-white/50 hover:text-white/80"}`}>
            {translateText("store.flags")}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {!cosmetics ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : activeTab === "patterns" ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
              {patternList.map((pattern) => {
                const rel = patternRelationship(pattern, null, userMe, null);
                return (
                  <button
                    key={pattern.name}
                    onClick={() => {
                      if (rel === "owned") {
                        selectPattern(pattern);
                      } else if (rel === "purchasable" && pattern.product) {
                        handlePurchase(pattern.product);
                      }
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                      rel === "owned"
                        ? "bg-white/10 border-blue-500/50 hover:bg-white/15"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <div className="w-12 h-12 rounded bg-white/10" />
                    <span className="text-xs text-white/70 truncate w-full text-center">{pattern.name}</span>
                    {rel === "purchasable" && pattern.product && (
                      <span className="text-xs text-green-400">${pattern.product.price}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {flagList.map((flag) => {
                const rel = flagRelationship(flag, userMe, null);
                return (
                  <button
                    key={flag.name}
                    onClick={() => {
                      if (rel === "owned") {
                        selectFlag(flag.name);
                      } else if (rel === "purchasable" && flag.product) {
                        handlePurchase(flag.product);
                      }
                    }}
                    className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors ${
                      rel === "owned"
                        ? "bg-white/10 border-blue-500/50"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <img src={flag.url} alt={flag.name} className="w-8 h-6 rounded object-cover" />
                    <span className="text-[10px] text-white/60 truncate w-full text-center">{flag.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
