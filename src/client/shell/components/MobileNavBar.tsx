import { useCallback, useEffect, useRef } from "react";
import { Platform } from "../../Platform";
import { useNavigation, type PageId } from "../contexts/NavigationContext";
import { useNotifications } from "../hooks/useNotifications";
import { NotificationDot } from "./NotificationDot";
import { OpenFrontLogo } from "./OpenFrontLogo";

function MobileNavItem({
  pageId,
  i18nKey,
  isActive,
  onClick,
  className = "",
  children,
}: {
  pageId: PageId;
  i18nKey: string;
  isActive: boolean;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const { showPage } = useNavigation();
  const baseButtonClass =
    "block text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)]";

  if (children) {
    // Wrapper div with notification dot
    return (
      <div
        className={`nav-menu-item flex items-center w-full cursor-pointer ${className}`}
        data-page={pageId}
        onClick={() => {
          onClick?.();
          showPage(pageId);
        }}
      >
        <button
          className={`${baseButtonClass} ${isActive ? "active" : ""}`}
          data-i18n={i18nKey}
        />
        {children}
      </div>
    );
  }

  return (
    <button
      className={`nav-menu-item block w-full text-left font-bold uppercase tracking-[0.05em] text-white/70 transition-all duration-200 cursor-pointer hover:text-blue-600 hover:translate-x-2.5 hover:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] [&.active]:text-blue-600 [&.active]:translate-x-2.5 [&.active]:drop-shadow-[0_0_20px_rgba(37,99,235,0.5)] text-[clamp(18px,2.8vh,32px)] py-[clamp(0.2rem,0.8vh,0.75rem)] ${
        isActive ? "active" : ""
      } ${className}`}
      data-page={pageId}
      data-i18n={i18nKey}
      onClick={() => {
        onClick?.();
        showPage(pageId);
      }}
    />
  );
}

export function MobileNavBar() {
  const { currentPage, isSidebarOpen, setSidebarOpen } = useNavigation();
  const notifications = useNotifications();
  const sidebarRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setSidebarOpen(false);
    document.documentElement.classList.remove("overflow-hidden");
  }, [setSidebarOpen]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!Platform.isMobileWidth) return;
      if (e.key === "Escape" && isSidebarOpen) {
        closeMenu();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isSidebarOpen, closeMenu]);

  // Close when nav item clicked on mobile
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const handler = (e: MouseEvent) => {
      if (!Platform.isMobileWidth) return;
      const clicked = (e.target as Element).closest?.(
        'a, button, [role="menuitem"], .nav-menu-item',
      );
      if (clicked) closeMenu();
    };
    sidebar.addEventListener("click", handler);
    return () => sidebar.removeEventListener("click", handler);
  }, [closeMenu]);

  return (
    <>
      {/* Backdrop */}
      <div
        id="mobile-menu-backdrop"
        className={`lg:hidden! in-[.in-game]:hidden ${
          isSidebarOpen
            ? "block pointer-events-auto fixed inset-0 bg-black/60 z-[40000] transition-opacity"
            : "hidden pointer-events-none"
        }`}
        role="presentation"
        aria-hidden={!isSidebarOpen}
        onClick={closeMenu}
      />

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        id="sidebar-menu"
        className={`peer [.in-game_&]:hidden z-[40001] fixed left-0 top-0 h-full flex flex-col justify-start overflow-visible bg-black/70 backdrop-blur-xl border-r border-white/10 transition-transform duration-500 ease-out transform w-[70%] lg:hidden ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        data-i18n-aria-label="main.menu"
      >
        <div className="flex-1 w-full flex flex-col justify-start overflow-y-auto lg:pt-[clamp(1rem,3vh,4rem)] lg:pb-[clamp(0.5rem,2vh,2rem)] lg:px-[clamp(1rem,1.5vw,2rem)] p-5 gap-[clamp(1rem,3vh,3rem)]">
          {/* Logo */}
          <div className="flex flex-col text-[#2563eb] mb-[clamp(1rem,2vh,2rem)] ml-[clamp(0.2rem,0.4vw,0.4vh)]">
            <div className="flex flex-col items-center gap-2">
              <OpenFrontLogo className="w-[clamp(120px,15vw,192px)] h-[clamp(40px,6vh,64px)] drop-shadow-[0_0_10px_rgba(37,99,235,0.3)]" />
              <div className="l-header__highlightText text-center game-version-display" />
            </div>
          </div>

          {/* Navigation Items */}
          <MobileNavItem
            pageId="page-play"
            i18nKey="main.play"
            isActive={currentPage === "page-play"}
          />

          <MobileNavItem
            pageId="page-news"
            i18nKey="main.news"
            isActive={currentPage === "page-news"}
            onClick={notifications.onNewsClick}
          >
            {notifications.showNewsDot && (
              <NotificationDot color="red" position="inline" />
            )}
          </MobileNavItem>

          <MobileNavItem
            pageId="page-leaderboard"
            i18nKey="main.leaderboard"
            isActive={currentPage === "page-leaderboard"}
          />

          <MobileNavItem
            pageId="page-item-store"
            i18nKey="main.store"
            isActive={currentPage === "page-item-store"}
            className="no-crazygames hidden"
            onClick={notifications.onStoreClick}
          >
            {notifications.showStoreDot && (
              <NotificationDot color="red" position="inline" />
            )}
          </MobileNavItem>

          <MobileNavItem
            pageId="page-settings"
            i18nKey="main.settings"
            isActive={currentPage === "page-settings"}
          />

          <MobileNavItem
            pageId="page-account"
            i18nKey="main.account"
            isActive={currentPage === "page-account"}
            className="no-crazygames"
          />

          <MobileNavItem
            pageId="page-help"
            i18nKey="main.help"
            isActive={currentPage === "page-help"}
            onClick={notifications.onHelpClick}
          >
            {notifications.showHelpDot && (
              <NotificationDot color="yellow" position="inline" />
            )}
          </MobileNavItem>

          <div className="flex flex-col w-full mt-auto [.in-game_&]:hidden items-end justify-end pt-4 border-t border-white/10" />
        </div>
      </div>
    </>
  );
}
