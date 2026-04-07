import React, { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { MessageType } from "../../core/game/Game";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "../../core/game/GameUpdates";
import { onlyImages } from "../../core/Util";
import { useGameTick } from "./useGameTick";

interface ChatEvent {
  description: string;
  unsafeDescription?: boolean;
  createdAt: number;
  highlight?: boolean;
}

export function ChatDisplay(): React.JSX.Element {
  const { gameView } = useGameTick(0);
  const [hidden, setHidden] = useState(false);
  const [newEvents, setNewEvents] = useState(0);
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>([]);

  useEffect(() => {
    const updates = gameView.updatesSinceLastTick();
    if (updates === null) return;

    const messages = updates[GameUpdateType.DisplayEvent] as
      | DisplayMessageUpdate[]
      | undefined;

    if (messages) {
      const myPlayer = gameView.myPlayer();
      const newChats = messages
        .filter((msg) => {
          if (msg.messageType !== MessageType.CHAT) return false;
          if (
            msg.playerID !== null &&
            (!myPlayer || myPlayer.smallID() !== msg.playerID)
          ) {
            return false;
          }
          return true;
        })
        .map((msg) => ({
          description: msg.message,
          unsafeDescription: true,
          createdAt: gameView.ticks(),
        }));

      if (newChats.length > 0) {
        setChatEvents((prev) => {
          const updated = [...prev, ...newChats];
          // Keep only last 100 messages
          return updated.length > 100 ? updated.slice(-100) : updated;
        });

        if (hidden) {
          setNewEvents((prev) => prev + newChats.length);
        }
      }
    }
  }, [gameView]);

  const toggleHidden = () => {
    setHidden((prev) => !prev);
    if (!hidden) {
      setNewEvents(0);
    }
  };

  const getChatContent = (chat: ChatEvent): React.ReactNode => {
    if (chat.unsafeDescription) {
      const sanitized = DOMPurify.sanitize(onlyImages(chat.description));
      return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
    }
    return chat.description;
  };

  return (
    <div
      data-testid="chat-display"
      className={`pointer-events-auto ${
        hidden ? "w-fit px-2.5 py-1.25" : ""
      } rounded-md bg-black/60 relative max-h-[30vh] flex flex-col-reverse overflow-y-auto w-full lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw] lg:w-full lg:w-auto`}
    >
      <div>
        <div className="w-full bg-black/80 sticky top-0 px-2.5">
          <button
            className={`text-white cursor-pointer pointer-events-auto ${
              hidden ? "hidden" : ""
            }`}
            onClick={toggleHidden}
          >
            Hide
          </button>
        </div>

        <button
          className={`text-white cursor-pointer pointer-events-auto ${
            hidden ? "" : "hidden"
          }`}
          onClick={toggleHidden}
        >
          Chat
          {newEvents > 0 && (
            <span className="inline-block px-2 bg-red-500 rounded-xs ml-1">
              {newEvents}
            </span>
          )}
        </button>

        <table
          className={`w-full border-collapse text-white shadow-lg lg:text-xl text-xs pointer-events-none ${
            hidden ? "hidden" : ""
          }`}
        >
          <tbody>
            {chatEvents.map((chat, idx) => (
              <tr key={idx} className="border-b border-gray-200/0">
                <td className="lg:p-3 p-1 text-left">
                  {getChatContent(chat)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
