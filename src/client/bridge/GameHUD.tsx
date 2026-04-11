import { useHUDStore } from "./HUDStore";

/**
 * Placeholder HUD overlay rendered as a React component on top of the
 * R3F canvas.  Future tickets will migrate the old Lit HUD layers
 * (leaderboard, control panel, build menu, etc.) into React components
 * that read from the Zustand HUDStore.
 *
 * For now this renders minimal diagnostic info so we can verify the
 * bridge is working.
 */
export function GameHUD() {
  const ticks = useHUDStore((s) => s.ticks);
  const myPlayer = useHUDStore((s) => s.myPlayer);
  const playerCount = useHUDStore((s) => s.players.size);

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        color: "white",
        fontFamily: "monospace",
        fontSize: 12,
        pointerEvents: "none",
        zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        padding: "4px 8px",
        borderRadius: 4,
      }}
    >
      <div>Tick: {ticks}</div>
      <div>Players: {playerCount}</div>
      {myPlayer && (
        <>
          <div>
            {myPlayer.displayName} — Population: {myPlayer.population}
          </div>
          <div>Tiles: {myPlayer.numTilesOwned}</div>
        </>
      )}
    </div>
  );
}
