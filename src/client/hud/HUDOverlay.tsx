import React from "react";
import { AlertFrame } from "./AlertFrame";
import { AttacksDisplay } from "./AttacksDisplay";
import { BuildMenu } from "./BuildMenu";
import { ChatDisplay } from "./ChatDisplay";
import { ChatModal } from "./ChatModal";
import { ControlPanel } from "./ControlPanel";
import { DonateResourceModal } from "./DonateResourceModal";
import { EmojiTable } from "./EmojiTable";
import { EventsDisplay } from "./EventsDisplay";
import { GameLeftSidebar } from "./GameLeftSidebar";
import { GameRightSidebar } from "./GameRightSidebar";
import { GameStartingModal } from "./GameStartingModal";
import { HeadsUpMessage } from "./HeadsUpMessage";
import { ImmunityTimer } from "./ImmunityTimer";
import { InGamePromo } from "./InGamePromo";
import { MultiTabModal } from "./MultiTabModal";
import { PerformanceOverlay } from "./PerformanceOverlay";
import { PlayerInfoOverlay } from "./PlayerInfoOverlay";
import { PlayerModerationModal } from "./PlayerModerationModal";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu } from "./RadialMenu";
import { ReplayPanel } from "./ReplayPanel";
import { SettingsModal } from "./SettingsModal";
import { SpawnTimer } from "./SpawnTimer";
import { UnitDisplay } from "./UnitDisplay";
import { WinModal } from "./WinModal";

/**
 * Root React component for the entire in-game HUD.
 * Rendered as a pure HTML overlay above the R3F canvas.
 * Layout mirrors the original index.html structure.
 */
export function HUDOverlay(): React.JSX.Element {
  return (
    <>
      {/* Bridge synchronisation is handled imperatively by GameBridge.tick()
          called from ClientGameRunner — no React component bridge needed. */}

      {/* Bottom HUD: responsive grid */}
      <div
        className="fixed bottom-0 left-0 w-full z-[200] flex flex-col pointer-events-none sm:flex-row sm:items-end lg:grid lg:grid-cols-[1fr_500px_1fr] lg:items-end min-[1200px]:px-4"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {/* HUD center column */}
        <div className="contents sm:flex sm:flex-col sm:pointer-events-none w-full sm:w-[500px] lg:col-start-2 sm:z-10">
          <div className="w-full pointer-events-auto order-1 sm:order-none">
            <AttacksDisplay />
          </div>
          <div className="pointer-events-auto bg-gray-800/92 backdrop-blur-sm sm:rounded-tr-lg lg:rounded-t-lg min-[1200px]:rounded-lg shadow-lg order-3 sm:order-none w-full">
            <ControlPanel />
            <div className="hidden lg:block w-full">
              <UnitDisplay />
            </div>
          </div>
        </div>

        {/* Events + chat: right column */}
        <div className="flex flex-col pointer-events-none items-end order-2 sm:order-none sm:flex-1 lg:col-start-3 lg:self-end lg:justify-end min-[1200px]:mr-4">
          <div className="w-full sm:w-auto pointer-events-auto">
            <ChatDisplay />
          </div>
          <div className="w-full sm:w-auto pointer-events-auto">
            <EventsDisplay />
          </div>
        </div>
      </div>

      {/* Game modals and overlays */}
      <GameStartingModal />
      <EmojiTable />
      <BuildMenu />
      <WinModal />

      {/* Right sidebar */}
      <div className="pointer-events-auto flex flex-col items-end fixed top-0 right-0 min-[1200px]:top-4 min-[1200px]:right-4 z-[1000] gap-2">
        <GameRightSidebar />
        <ReplayPanel visible={false} isSingleplayer={false} />
      </div>

      <SettingsModal />
      <RadialMenu />
      <PlayerPanel />
      <SpawnTimer />
      <ImmunityTimer />
      <AlertFrame />
      <ChatModal />
      <MultiTabModal />
      <DonateResourceModal />
      <GameLeftSidebar />
      <PerformanceOverlay />
      <PlayerInfoOverlay />
      <HeadsUpMessage />
      <InGamePromo />
      <PlayerModerationModal />
    </>
  );
}
