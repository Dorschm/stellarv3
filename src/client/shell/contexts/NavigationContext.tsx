import { createContext, useCallback, useContext, useState } from "react";

export type PageId =
  | "page-play"
  | "page-news"
  | "page-leaderboard"
  | "page-item-store"
  | "page-settings"
  | "page-account"
  | "page-help"
  | "page-matchmaking"
  | "page-single-player"
  | "page-host-lobby"
  | "page-join-lobby"
  | "page-troubleshooting"
  | "page-language"
  | "page-ranked"
  | "flag-input-modal"
  | "territory-patterns-modal";

interface NavigationContextValue {
  currentPage: PageId;
  showPage: (pageId: PageId) => void;
  /** For legacy compat — exposes showPage on window */
  closeMobileSidebar: () => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentPage, setCurrentPage] = useState<PageId>("page-play");
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const closeMobileSidebar = useCallback(() => {
    setSidebarOpen(false);
    document.documentElement.classList.remove("overflow-hidden");
  }, []);

  const showPage = useCallback(
    (pageId: PageId) => {
      setCurrentPage(pageId);
      closeMobileSidebar();
      // Keep window.currentPageId in sync for legacy compatibility
      window.currentPageId = pageId;
      // Dispatch event for any remaining legacy listeners
      window.dispatchEvent(new CustomEvent("showPage", { detail: pageId }));
    },
    [closeMobileSidebar],
  );

  // Expose showPage on window for legacy code that calls it
  window.showPage = showPage as (pageId: string) => void;

  return (
    <NavigationContext.Provider
      value={{
        currentPage,
        showPage,
        closeMobileSidebar,
        isSidebarOpen,
        setSidebarOpen,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be inside NavigationProvider");
  return ctx;
}
