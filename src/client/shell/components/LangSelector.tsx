import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { assetUrl } from "../../../core/AssetUrls";
import { useNavigation } from "../contexts/NavigationContext";
import metadata from "../../../../resources/lang/metadata.json";
import en from "../../../../resources/lang/en.json";
import { formatDebugTranslation } from "../../Utils";

type LanguageMetadata = {
  code: string;
  native: string;
  en: string;
  svg: string;
};

interface LangContextValue {
  currentLang: string;
  translations: Record<string, string> | undefined;
  defaultTranslations: Record<string, string> | undefined;
  changeLanguage: (lang: string) => Promise<void>;
  translateText: (
    key: string,
    params?: Record<string, string | number>
  ) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

function flattenTranslations(
  obj: Record<string, any>,
  parentKey = "",
  result: Record<string, string> = {}
): Record<string, string> {
  for (const key in obj) {
    const value = obj[key];
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (typeof value === "string") {
      result[fullKey] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTranslations(value, fullKey, result);
    } else {
      console.warn("Unknown type", typeof value, value);
    }
  }

  return result;
}

function getClosestSupportedLang(lang: string): string {
  if (!lang) return "en";
  if (lang === "debug") return "debug";

  const languageMetadata: LanguageMetadata[] = metadata;
  const supported = new Set(languageMetadata.map((entry) => entry.code));

  if (supported.has(lang)) return lang;

  const base = lang.slice(0, 2);
  if (supported.has(base)) return base;

  const candidates = Array.from(supported).filter((key) =>
    key.startsWith(base)
  );
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  }

  return "en";
}

export function useLang(): LangContextValue {
  const context = useContext(LangContext);
  if (!context) {
    throw new Error("useLang must be used within a LangProvider");
  }
  return context;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [currentLang, setCurrentLang] = useState<string>("en");
  const [translations, setTranslations] = useState<Record<string, string>>();
  const [defaultTranslations, setDefaultTranslations] = useState<
    Record<string, string>
  >();
  const [languageList, setLanguageList] = useState<LanguageMetadata[]>([]);
  const [debugKeyPressed, setDebugKeyPressed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const languageMetadata: LanguageMetadata[] = metadata;
  const languageCache = new Map<string, Record<string, string>>();

  // Initialize language on mount
  useEffect(() => {
    initializeLanguage();
    setupDebugKey();
  }, []);

  const setupDebugKey = useCallback(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() === "t") setDebugKeyPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() === "t") setDebugKeyPressed(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const loadLanguage = useCallback(
    async (lang: string): Promise<Record<string, string>> => {
      if (!lang) return {};

      const cached = languageCache.get(lang);
      if (cached) return cached;

      if (lang === "debug") {
        const empty: Record<string, string> = {};
        languageCache.set(lang, empty);
        return empty;
      }

      if (lang === "en") {
        const flat = flattenTranslations(en);
        languageCache.set(lang, flat);
        return flat;
      }

      try {
        const response = await fetch(
          assetUrl(`lang/${encodeURIComponent(lang)}.json`)
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch language ${lang}: ${response.status}`);
        }
        const language = (await response.json()) as Record<string, any>;
        const flat = flattenTranslations(language);
        languageCache.set(lang, flat);
        return flat;
      } catch (err) {
        console.error(`Failed to load language ${lang}:`, err);
        return {};
      }
    },
    []
  );

  const loadLanguageList = useCallback(async () => {
    try {
      let list: LanguageMetadata[] = [];

      const browserLang = new Intl.Locale(navigator.language).language;

      let debugLang: LanguageMetadata | null = null;
      if (debugKeyPressed || currentLang === "debug") {
        debugLang = {
          code: "debug",
          native: "Debug",
          en: "Debug",
          svg: "xx",
        };
        setDebugMode(true);
      }

      for (const langData of languageMetadata) {
        if (langData.code === "debug" && !debugLang) continue;
        list.push({
          code: langData.code,
          native: langData.native,
          en: langData.en,
          svg: langData.svg,
        });
      }

      const currentLangEntry = list.find((l) => l.code === currentLang);
      const browserLangEntry =
        browserLang !== currentLang && browserLang !== "en"
          ? list.find((l) => l.code === browserLang)
          : undefined;
      const englishEntry =
        currentLang !== "en" ? list.find((l) => l.code === "en") : undefined;

      list = list.filter(
        (l) =>
          l.code !== currentLang &&
          l.code !== browserLang &&
          l.code !== "en" &&
          l.code !== "debug"
      );

      list.sort((a, b) => a.en.localeCompare(b.en));

      const finalList: LanguageMetadata[] = [];
      if (currentLangEntry) finalList.push(currentLangEntry);
      if (englishEntry) finalList.push(englishEntry);
      if (browserLangEntry) finalList.push(browserLangEntry);
      finalList.push(...list);
      if (debugLang) finalList.push(debugLang);

      setLanguageList(finalList);
    } catch (err) {
      console.error("Failed to load language list:", err);
    }
  }, [currentLang, debugKeyPressed, languageMetadata]);

  const initializeLanguage = useCallback(async () => {
    const browserLocale = navigator.language;
    const savedLang = localStorage.getItem("lang");
    const userLang = getClosestSupportedLang(savedLang ?? browserLocale);

    const [defaultTrans, userTrans] = await Promise.all([
      loadLanguage("en"),
      loadLanguage(userLang),
    ]);

    setDefaultTranslations(defaultTrans);
    setTranslations(userTrans);
    setCurrentLang(userLang);

    await loadLanguageList();
    applyTranslation(userTrans, defaultTrans, userLang);
  }, [loadLanguage, loadLanguageList]);

  const changeLanguage = useCallback(
    async (lang: string) => {
      localStorage.setItem("lang", lang);
      const trans = await loadLanguage(lang);
      setTranslations(trans);
      setCurrentLang(lang);
      applyTranslation(trans, defaultTranslations, lang);

      // Dispatch event for language change
      document.dispatchEvent(
        new CustomEvent("language-selected", {
          detail: { lang },
        })
      );

      // Expose on window for backward compat
      (window as any).langSelector = {
        currentLang: lang,
        translations: trans,
        defaultTranslations,
        changeLanguage,
      };
    },
    [loadLanguage, defaultTranslations]
  );

  const translateText = useCallback(
    (key: string, params: Record<string, string | number> = {}): string => {
      if (currentLang === "debug") {
        return formatDebugTranslation(key, params);
      }

      let text: string | undefined;
      if (translations && key in translations) {
        text = translations[key];
      } else if (defaultTranslations && key in defaultTranslations) {
        text = defaultTranslations[key];
      } else {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }

      for (const param in params) {
        const value = params[param];
        text = text.replace(`{${param}}`, String(value));
      }

      return text;
    },
    [currentLang, translations, defaultTranslations]
  );

  const applyTranslation = (
    trans: Record<string, string> | undefined,
    defTrans: Record<string, string> | undefined,
    lang: string
  ) => {
    const components = [
      "single-player-modal",
      "host-lobby-modal",
      "join-lobby-modal",
      "emoji-table",
      "leader-board",
      "leaderboard-tabs",
      "leaderboard-player-list",
      "leaderboard-clan-table",
      "build-menu",
      "win-modal",
      "game-starting-modal",
      "top-bar",
      "player-panel",
      "replay-panel",
      "help-modal",
      "settings-modal",
      "username-input",
      "game-mode-selector",
      "user-setting",
      "o-modal",
      "o-button",
      "territory-patterns-modal",
      "store-modal",
      "pattern-input",
      "fluent-slider",
      "news-modal",
      "news-button",
      "account-modal",
      "leaderboard-modal",
      "flag-input-modal",
      "flag-input",
      "matchmaking-button",
      "token-login",
    ];

    // Update document title
    const titleKey = "main.title";
    let title = trans?.[titleKey] ?? defTrans?.[titleKey];
    if (title) {
      document.title = title;
    }

    // Update elements with data-i18n
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (key === null) return;
      let text = trans?.[key] ?? defTrans?.[key];
      if (text === undefined || text === null) {
        console.warn(`Translation key not found: ${key}`);
        return;
      }
      element.textContent = text;
    });

    // Update attribute translations
    const applyAttributeTranslation = (
      dataAttr: string,
      targetAttr: string
    ): void => {
      document.querySelectorAll(`[${dataAttr}]`).forEach((element) => {
        const key = element.getAttribute(dataAttr);
        if (key === null) return;
        let text = trans?.[key] ?? defTrans?.[key];
        if (text === undefined || text === null) {
          console.warn(`Translation key not found: ${key}`);
          return;
        }
        element.setAttribute(targetAttr, text);
      });
    };

    applyAttributeTranslation("data-i18n-title", "title");
    applyAttributeTranslation("data-i18n-alt", "alt");
    applyAttributeTranslation("data-i18n-aria-label", "aria-label");
    applyAttributeTranslation("data-i18n-placeholder", "placeholder");

    // Request updates from Lit components
    components.forEach((tag) => {
      document.querySelectorAll(tag).forEach((el) => {
        if (typeof (el as any).requestUpdate === "function") {
          (el as any).requestUpdate();
        }
      });
    });
  };

  // Expose on window for backward compatibility
  // Publish on `window.langSelector` so the imperative `translateText`
  // helper in src/client/Utils.ts can find it. That helper is called
  // *during* child render (e.g. in PlayPage, modals, HUD components), so
  // the handle MUST exist before React commits the children — which
  // means we set it synchronously here, not in a useEffect. A useEffect
  // is still needed to keep the bag current when the language changes
  // after mount (debug toggle, language switch), so both mechanisms run.
  if (translations || defaultTranslations) {
    (window as any).langSelector = {
      currentLang,
      translations,
      defaultTranslations,
      changeLanguage,
    };
  }
  useEffect(() => {
    (window as any).langSelector = {
      currentLang,
      translations,
      defaultTranslations,
      changeLanguage,
    };
  }, [currentLang, translations, defaultTranslations, changeLanguage]);

  const contextValue: LangContextValue = {
    currentLang,
    translations,
    defaultTranslations,
    changeLanguage,
    translateText,
  };

  // Hold the first render until the default (English) language has been
  // loaded. Without this gate, children render once with `translations`
  // still undefined — `translateText` then returns raw keys (e.g.
  // "main.solo") and the mounted DOM never re-renders when the async
  // `initializeLanguage()` finally resolves. Gating here is cheap because
  // `loadLanguage("en")` imports a bundled JSON file synchronously from
  // the module graph; the initial paint is delayed by a single microtask.
  if (!translations && !defaultTranslations) {
    return null;
  }

  return (
    <LangContext.Provider value={contextValue}>{children}</LangContext.Provider>
  );
}

export function LangSelector() {
  const { currentLang } = useLang();
  const { showPage } = useNavigation();
  const languageMetadata: LanguageMetadata[] = metadata;

  // Get current language metadata
  const currentLangMeta = languageMetadata.find((l) => l.code === currentLang) ?? {
    native: "English",
    en: "English",
    svg: "uk_us_flag",
  };

  const handleClick = () => {
    showPage("page-language");
  };

  return (
    <button
      id="lang-selector"
      title="Change Language"
      onClick={handleClick}
      className="border-none bg-none cursor-pointer p-0 flex items-center justify-center transition-transform duration-200 hover:scale-[1.1] active:scale-[0.9] opacity-60 hover:opacity-100 w-[40px] h-[40px] lg:w-[56px] lg:h-[56px]"
    >
      <img
        id="lang-flag"
        className="object-contain pointer-events-none transition-all w-[40px] h-[40px] lg:w-[48px] lg:h-[48px]"
        src={assetUrl(`flags/${currentLangMeta.svg}.svg`)}
        alt="flag"
        draggable={false}
      />
    </button>
  );
}
