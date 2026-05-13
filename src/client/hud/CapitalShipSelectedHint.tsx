import React from "react";
import { useHUDStore } from "../bridge/HUDStore";

/**
 * Issue #4 — small fixed HUD hint shown while a Battlecruiser is selected.
 * Tells the user the next click moves the cruiser, the structure hotkeys
 * (1–6) host on the slot, and Esc deselects. Positioned bottom-center above
 * the ControlPanel so it doesn't compete with the heads-up message at top.
 */
export function CapitalShipSelectedHint(): React.JSX.Element | null {
  const selectedId = useHUDStore((s) => s.selectedBattlecruiserUnitId);
  if (selectedId === null) return null;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[799] pointer-events-none rounded-lg px-4 py-2 text-white text-sm lg:text-base bg-gray-800/85 backdrop-blur-xs"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 18rem)",
        border: "1px solid rgba(74,158,255,0.55)",
        boxShadow: "0 0 18px rgba(74,158,255,0.35)",
      }}
      data-testid="capital-ship-selected-hint"
      onContextMenu={(e) => e.preventDefault()}
    >
      <strong>Capital ship selected</strong>
      <span className="ml-2 opacity-80">
        Left-click to move &middot; 1–6 to build on slot &middot; Esc to
        deselect
      </span>
    </div>
  );
}

export default CapitalShipSelectedHint;
