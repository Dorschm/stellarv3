import { FlagInput } from "./FlagInput";
import { GameModeSelector } from "./GameModeSelector";
import { OpenFrontLogo } from "./OpenFrontLogo";
import { PatternInput } from "./PatternInput";
import { UsernameInput } from "./UsernameInput";
import { useNavigation } from "../contexts/NavigationContext";

export function PlayPage() {
  const { currentPage, setSidebarOpen } = useNavigation();

  const isVisible = currentPage === "page-play";

  const openFlagModal = () => window.showPage?.("flag-input-modal");
  const openPatternModal = () =>
    window.showPage?.("territory-patterns-modal");

  return (
    <div
      id="page-play"
      className={`flex flex-col gap-2 w-full px-0 lg:px-4 lg:my-auto min-h-0 ${
        isVisible ? "" : "hidden"
      }`}
    >
      {/* Mobile: Fixed top bar */}
      <div className="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] border-b border-white/10">
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

          <div className="col-start-2 flex items-center justify-center text-[#2563eb] min-w-0">
            <OpenFrontLogo className="h-6 w-auto drop-shadow-[0_0_10px_rgba(37,99,235,0.3)] shrink-0" />
          </div>

          <div
            aria-hidden="true"
            className="col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3]"
          />
        </div>
      </div>

      <div className="w-full pb-4 lg:pb-0 flex flex-col gap-4 sm:-mx-4 sm:w-[calc(100%+2rem)] lg:mx-0 lg:w-full lg:grid lg:grid-cols-[2fr_1fr] lg:gap-4">
        {/* Mobile: spacer for fixed top bar */}
        <div className="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] lg:col-span-2 -mb-4" />

        {/* Username: left col */}
        <div className="px-2 py-2 bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] border-y border-white/10 overflow-visible lg:flex lg:items-center lg:gap-x-2 lg:h-[60px] lg:p-3 lg:relative lg:z-20 lg:border-y-0 lg:rounded-xl">
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
