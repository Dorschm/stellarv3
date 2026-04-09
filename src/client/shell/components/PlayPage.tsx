import { useNavigation } from "../contexts/NavigationContext";
import { FlagInput } from "./FlagInput";
import { GameModeSelector } from "./GameModeSelector";
import { PatternInput } from "./PatternInput";
import { StellarGameLogo } from "./StellarGameLogo";
import { UsernameInput } from "./UsernameInput";

function StarfieldBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#050a18] via-[#0d1b3e] to-[#0a0f24]" />
      {/* Nebula glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-purple-600/10 rounded-full blur-[100px]" />
      <div className="absolute top-3/4 right-0 w-[400px] h-[200px] bg-cyan-500/8 rounded-full blur-[80px]" />
    </div>
  );
}

export function PlayPage() {
  const { currentPage, setSidebarOpen } = useNavigation();

  const isVisible = currentPage === "page-play";

  const openFlagModal = () => window.showPage?.("flag-input-modal");
  const openPatternModal = () => window.showPage?.("territory-patterns-modal");

  return (
    <div
      id="page-play"
      className={`flex flex-col gap-2 w-full px-0 lg:px-4 lg:my-auto min-h-0 ${
        isVisible ? "" : "hidden"
      }`}
    >
      {/* Mobile: Fixed top bar */}
      <div className="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-[#0d1b3e]/95 border-b border-cyan-400/10 backdrop-blur-md">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14 px-2 gap-2">
          <button
            id="hamburger-btn"
            className="col-start-1 justify-self-start h-10 shrink-0 aspect-[4/3] flex text-white/90 rounded-md items-center justify-center transition-colors"
            data-i18n-aria-label="main.menu"
            aria-expanded="false"
            aria-controls="sidebar-menu"
            aria-haspopup="dialog"
            data-i18n-title="main.menu"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarOpen(true);
              document.documentElement.classList.add("overflow-hidden");
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </button>

          <div className="col-start-2 flex items-center justify-center text-cyan-400 min-w-0">
            <StellarGameLogo className="h-6 w-auto drop-shadow-[0_0_12px_rgba(34,211,238,0.4)] shrink-0" />
          </div>

          <div
            aria-hidden="true"
            className="col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3]"
          />
        </div>
      </div>

      {/* Desktop: Space-themed hero section */}
      <div className="hidden lg:flex flex-col items-center justify-center relative rounded-2xl overflow-hidden py-6 mb-2">
        <StarfieldBackground />
        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className="text-cyan-400">
            <StellarGameLogo className="h-10 w-auto drop-shadow-[0_0_20px_rgba(34,211,238,0.5)]" />
          </div>
          <p className="text-cyan-200/50 text-sm tracking-[0.3em] uppercase font-medium">
            Conquer the Galaxy
          </p>
        </div>
      </div>

      <div className="w-full pb-4 lg:pb-0 flex flex-col gap-4 sm:-mx-4 sm:w-[calc(100%+2rem)] lg:mx-0 lg:w-full lg:grid lg:grid-cols-[2fr_1fr] lg:gap-4">
        {/* Mobile: spacer for fixed top bar */}
        <div className="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] lg:col-span-2 -mb-4" />

        {/* Username: left col */}
        <div className="px-2 py-2 bg-[#0d1b3e]/80 border-y border-cyan-400/10 overflow-visible lg:flex lg:items-center lg:gap-x-2 lg:h-[60px] lg:p-3 lg:relative lg:z-20 lg:border lg:border-cyan-400/10 lg:rounded-xl lg:backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0 w-full">
            <UsernameInput />
            <PatternInput
              showSelectLabel
              adaptiveSize
              className="shrink-0 lg:hidden"
              onClick={openPatternModal}
            />
            <FlagInput
              showSelectLabel
              className="shrink-0 lg:hidden h-10 w-10"
              onClick={openFlagModal}
            />
          </div>
        </div>

        {/* Skin + flag: right col */}
        <div className="hidden lg:flex h-[60px] gap-2">
          <PatternInput
            showSelectLabel
            className="flex-1 h-full"
            onClick={openPatternModal}
          />
          <FlagInput
            showSelectLabel
            className="flex-1 h-full"
            onClick={openFlagModal}
          />
        </div>
      </div>

      <GameModeSelector />
    </div>
  );
}
