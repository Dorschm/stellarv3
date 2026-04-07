import React, { useEffect, useState } from "react";
import { translateText } from "../Utils";

/**
 * Module-level visibility state for GameStartingModal.
 *
 * The window hook (`__gameStartingModal.hide()` / `.show()`) is wired up at
 * module load time rather than during React render so that callers can drive
 * it *before* the React tree has committed. `ClientGameRunner` calls
 * `mountReactRoot()` and then immediately calls `__gameStartingModal.hide()`
 * — but `createRoot().render()` is async, so at that moment no component
 * instance exists yet. Previously the hide() call was lost and the modal
 * stayed visible forever.
 *
 * We solve this by storing the current visibility in a module-scoped
 * variable. `show()`/`hide()` update that variable *and* forward to the
 * mounted component's setter if one is registered. When the component mounts
 * later, its initial state reads the module variable, so any pre-mount
 * hide() is honored on first paint.
 */
let moduleIsVisible = true;
let moduleSetter: ((visible: boolean) => void) | null = null;

if (typeof window !== "undefined") {
  (window as unknown as {
    __gameStartingModal: { show: () => void; hide: () => void };
  }).__gameStartingModal = {
    show: () => {
      moduleIsVisible = true;
      moduleSetter?.(true);
    },
    hide: () => {
      moduleIsVisible = false;
      moduleSetter?.(false);
    },
  };
}

export function GameStartingModal(): React.JSX.Element {
  const [isVisible, setIsVisible] = useState(moduleIsVisible);

  useEffect(() => {
    moduleSetter = setIsVisible;
    // If hide() was called before mount, the setter didn't exist yet —
    // reconcile by re-reading the module state on mount.
    setIsVisible(moduleIsVisible);
    return () => {
      if (moduleSetter === setIsVisible) {
        moduleSetter = null;
      }
    };
  }, []);

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/30 backdrop-blur-[4px] z-[9998] transition-all duration-300 ${
          isVisible ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
      ></div>
      <div
        className={`fixed top-1/2 left-1/2 bg-zinc-900/90 backdrop-blur-md border border-white/10 p-6 rounded-2xl z-[9999] shadow-2xl text-white w-[400px] text-center transition-all duration-300 -translate-x-1/2 ${
          isVisible
            ? "opacity-100 visible -translate-y-1/2"
            : "opacity-0 invisible -translate-y-[48%]"
        }`}
      >
        <div className="text-base font-medium tracking-wider uppercase text-white/40 mb-3">
          © OpenFront and Contributors
        </div>
        <a
          href="https://github.com/openfrontio/OpenFrontIO/blob/main/CREDITS.md"
          target="_blank"
          rel="noopener noreferrer"
          className="block mb-4 text-lg font-medium tracking-wider uppercase text-sky-400 no-underline transition-colors duration-200 hover:text-sky-300"
        >
          {translateText("game_starting_modal.credits")}
        </a>
        <p className="text-base text-white/40 mb-4">
          {translateText("game_starting_modal.code_license")}
        </p>
        <p className="text-xl font-medium tracking-wider text-white bg-white/5 border border-white/10 px-4 py-3 rounded-xl">
          {translateText("game_starting_modal.title")}
        </p>
      </div>
    </>
  );
}

export default GameStartingModal;
