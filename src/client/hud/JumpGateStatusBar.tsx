import React from "react";
import { useHUDStore } from "../bridge/HUDStore";

/**
 * Lightweight status overlay shown during Jump Gate selection mode.
 *
 * - `selectSource` -> "Select source gate" + ESC hint
 * - `selectDest`   -> "Select destination gate" + ESC hint
 * - `idle`         -> renders nothing
 *
 * Carries a stable `data-testid` so SettingsModal can detect it as an
 * active overlay and suppress the Escape -> Settings path.
 */
export function JumpGateStatusBar(): React.JSX.Element | null {
  const mode = useHUDStore((s) => s.jumpGateMode);

  if (mode === "idle") return null;

  const label =
    mode === "selectSource"
      ? "\u2B21 Select source gate"
      : "\u2B21 Select destination gate";

  return (
    <div
      data-testid="jump-gate-status-bar"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[9600] pointer-events-none select-none"
    >
      <div className="bg-[rgba(30,50,80,0.9)] border border-[#3a6ea5] rounded-lg px-6 py-2 text-center shadow-lg">
        <div className="text-[#7ec8e3] font-semibold text-sm">{label}</div>
        <div className="text-[#8899aa] text-xs mt-1">Press ESC to cancel</div>
      </div>
    </div>
  );
}
