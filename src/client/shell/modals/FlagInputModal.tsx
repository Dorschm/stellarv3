import { useCallback, useState } from "react";
import Countries from "resources/countries.json";
import type { Cosmetics } from "../../../core/CosmeticSchemas";
import type { UserMeResponse } from "../../../core/ApiSchemas";
import { assetUrl } from "../../../core/AssetUrls";
import { UserSettings } from "../../../core/game/UserSettings";
import { fetchCosmetics, flagRelationship } from "../../Cosmetics";
import { getUserMe } from "../../Api";
import { userAuth } from "../../Auth";
import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

export function FlagInputModal() {
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

  const setFlag = useCallback((flag: string) => {
    userSettings.setFlag(flag);
    window.dispatchEvent(new CustomEvent("show-message", {
      detail: { message: `Flag selected`, color: "green", duration: 1500 },
    }));
    document.dispatchEvent(new CustomEvent("event:user-settings-changed:flag"));
    showPage("page-play");
  }, [userSettings, showPage]);

  const filteredCountries = Countries.filter((c) => {
    if (c.code === "xx") return false;
    if ("restricted" in c && c.restricted) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
  });

  const cosmeticFlags = cosmetics
    ? Object.values(cosmetics.flags).filter((f) => {
        if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
        return flagRelationship(f, userMe, null) === "owned";
      })
    : [];

  return (
    <ModalPage pageId="flag-input-modal" onOpen={onOpen} onClose={onClose}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("flag_input.title")}</h2>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translateText("flag_input.search")}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500/50 w-40"
            />
            <button onClick={() => showPage("page-item-store")} className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-medium hover:bg-blue-600/30 transition-colors">
              {translateText("main.store")}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {/* None option */}
          <button onClick={() => setFlag("")} className="mb-3 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-colors text-sm w-full text-left">
            {translateText("flag_input.none")}
          </button>

          {/* Cosmetic flags */}
          {cosmeticFlags.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-2">{translateText("flag_input.cosmetic_flags")}</p>
              <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                {cosmeticFlags.map((flag) => (
                  <button key={flag.name} onClick={() => setFlag(`flag:${flag.name}`)} className="flex flex-col items-center gap-1 p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors" title={flag.name}>
                    <img src={flag.url} alt={flag.name} className="w-8 h-6 rounded object-cover" />
                    <span className="text-[10px] text-white/50 truncate w-full text-center">{flag.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Country flags */}
          <p className="text-xs text-white/40 uppercase tracking-wider mb-2">{translateText("flag_input.country_flags")}</p>
          <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
            {filteredCountries.map((country) => (
              <button key={country.code} onClick={() => setFlag(`country:${country.code}`)} className="flex flex-col items-center gap-1 p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors" title={country.name}>
                <img src={assetUrl(`/flags/${country.code}.svg`)} alt={country.name} className="w-8 h-6 rounded object-cover" />
                <span className="text-[10px] text-white/50 truncate w-full text-center">{country.name}</span>
              </button>
            ))}
          </div>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
