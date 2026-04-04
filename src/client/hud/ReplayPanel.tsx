import React, { useEffect, useState } from "react";
import { ReplaySpeedChangeEvent } from "../InputHandler";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../utilities/ReplaySpeedMultiplier";
import { translateText } from "../Utils";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import { ShowReplayPanelEvent } from "./events";

interface ReplayPanelProps {
  visible: boolean;
  isSingleplayer: boolean;
}

function ReplayPanel({
  visible: initialVisible,
  isSingleplayer: initialIsSingleplayer,
}: ReplayPanelProps): React.JSX.Element {
  const { gameView, eventBus } = useGameView();
  const [visible, setVisible] = useState(initialVisible);
  const [isSingleplayer, setIsSingleplayer] = useState(initialIsSingleplayer);
  const [replaySpeedMultiplier, setReplaySpeedMultiplier] = useState(
    defaultReplaySpeedMultiplier,
  );

  // Listen to ShowReplayPanelEvent
  useEventBus(eventBus, ShowReplayPanelEvent, (event) => {
    setVisible(event.visible);
    setIsSingleplayer(event.isSingleplayer);
  });

  // Listen to ReplaySpeedChangeEvent
  useEventBus(eventBus, ReplaySpeedChangeEvent, (event) => {
    setReplaySpeedMultiplier(event.replaySpeedMultiplier);
  });

  const onReplaySpeedChange = (value: ReplaySpeedMultiplier) => {
    setReplaySpeedMultiplier(value);
    eventBus.emit(new ReplaySpeedChangeEvent(value));
  };

  const renderSpeedButton = (value: ReplaySpeedMultiplier, label: string) => {
    const isSelected = replaySpeedMultiplier === value;
    const backgroundColor = isSelected ? "bg-blue-400" : "";

    return (
      <button
        key={value}
        className={`py-0.5 px-1 text-sm text-white rounded-sm border transition border-gray-500 ${backgroundColor} hover:border-gray-200`}
        onClick={() => onReplaySpeedChange(value)}
      >
        {label}
      </button>
    );
  };

  if (!visible) {
    return <></>;
  }

  return (
    <div
      className="p-2 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-l-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      <label className="block mb-2 text-white" translate="no">
        {gameView.config().isReplay()
          ? translateText("replay_panel.replay_speed")
          : translateText("replay_panel.game_speed")}
      </label>
      <div className="grid grid-cols-4 gap-2">
        {renderSpeedButton(ReplaySpeedMultiplier.slow, "×0.5")}
        {renderSpeedButton(ReplaySpeedMultiplier.normal, "×1")}
        {renderSpeedButton(ReplaySpeedMultiplier.fast, "×2")}
        {renderSpeedButton(
          ReplaySpeedMultiplier.fastest,
          translateText("replay_panel.fastest_game_speed"),
        )}
      </div>
    </div>
  );
}

export { ReplayPanel };
export default ReplayPanel;
