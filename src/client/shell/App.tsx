import { useEffect } from "react";
import version from "resources/version.txt?raw";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { DesktopNavBar } from "./components/DesktopNavBar";
import { Footer } from "./components/Footer";
import { LangProvider } from "./components/LangSelector";
import { MainLayout } from "./components/MainLayout";
import { MobileNavBar } from "./components/MobileNavBar";
import { PlayPage } from "./components/PlayPage";
import { ClientProvider } from "./contexts/ClientContext";
import { NavigationProvider } from "./contexts/NavigationContext";
import { AccountModal } from "./modals/AccountModal";
import { FlagInputModal } from "./modals/FlagInputModal";
import { HelpModal } from "./modals/HelpModal";
import { HostLobbyModal } from "./modals/HostLobbyModal";
import { JoinLobbyModal } from "./modals/JoinLobbyModal";
import { LanguageModal } from "./modals/LanguageModal";
import { LeaderboardModal } from "./modals/LeaderboardModal";
import { MatchmakingModal } from "./modals/MatchmakingModal";
import { NewsModal } from "./modals/NewsModal";
import { RankedModal } from "./modals/RankedModal";
import { SinglePlayerModal } from "./modals/SinglePlayerModal";
import { StoreModal } from "./modals/StoreModal";
import { TerritoryPatternsModal } from "./modals/TerritoryPatternsModal";
import { TokenLoginModal } from "./modals/TokenLoginModal";
import { TroubleshootingModal } from "./modals/TroubleshootingModal";
import { UserSettingModal } from "./modals/UserSettingModal";

/**
 * Set version text on all game-version display elements.
 */
function useVersionDisplay() {
  useEffect(() => {
    const trimmed = version.trim();
    const displayVersion = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
    document
      .querySelectorAll("#game-version, .game-version-display")
      .forEach((el) => {
        el.textContent = displayVersion;
      });
  }, []);
}

/**
 * Hide CrazyGames-only elements if not on CrazyGames.
 */
function useHideCrazyGamesElements() {
  useEffect(() => {
    const hide = () => {
      if (crazyGamesSDK.isOnCrazyGames()) {
        document.querySelectorAll(".no-crazygames").forEach((el) => {
          (el as HTMLElement).style.display = "none";
        });
      }
    };
    hide();
    setTimeout(hide, 100);
    setTimeout(hide, 500);
  }, []);
}

export function App() {
  useVersionDisplay();
  useHideCrazyGamesElements();

  return (
    <LangProvider>
      <NavigationProvider>
        <ClientProvider>
        {/* Mobile sidebar + backdrop */}
        <MobileNavBar />

        {/* Main content area — hidden when in-game */}
        <div className="in-[.in-game]:hidden flex-1 relative overflow-hidden h-full transition-[margin] duration-500 ease-out will-change-[margin-left] flex flex-col">
          {/* Desktop top bar */}
          <DesktopNavBar />

          {/* Turnstile container */}
          <div
            id="turnstile-container"
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-99999"
          />

          {/* Main content */}
          <MainLayout>
            <PlayPage />
            <MatchmakingModal />
            <NewsModal />
            <SinglePlayerModal />
            <HostLobbyModal />
            <JoinLobbyModal />
            <StoreModal />
            <UserSettingModal />
            <LeaderboardModal />
            <TroubleshootingModal />
            <AccountModal />
            <HelpModal />
            <LanguageModal />
            <FlagInputModal />
            <TerritoryPatternsModal />
            <RankedModal />
          </MainLayout>

          {/* Footer */}
          <div className="[.in-game_&]:hidden mt-auto flex flex-col shrink-0">
            <Footer />
          </div>
        </div>

          {/* Token login (floating, not page-based) */}
          <TokenLoginModal />
        </ClientProvider>
      </NavigationProvider>
    </LangProvider>
  );
}
