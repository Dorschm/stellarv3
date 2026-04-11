import DOMPurify from "dompurify";
import React, { useEffect, useRef, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import {
  getMessageCategory,
  MessageCategory,
  MessageType,
  Tick,
} from "../../core/game/Game";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "../../core/game/GameUpdates";
import { GameView, PlayerView, UnitView } from "../../core/game/GameView";
import { onlyImages } from "../../core/Util";
import { SendAllianceExtensionIntentEvent } from "../Transport";
import { translateText } from "../Utils";
import { GoToPlayerEvent } from "./events";
import { useGameTick } from "./useGameTick";

const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const nukeIcon = assetUrl("images/NukeIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");

interface GameEvent {
  description: string;
  unsafeDescription?: boolean;
  buttons?: {
    text: string;
    className: string;
    action: () => void;
    preventClose?: boolean;
  }[];
  type: MessageType;
  highlight?: boolean;
  createdAt: number;
  onDelete?: () => void;
  priority?: number;
  duration?: Tick;
  focusID?: number;
  unitView?: UnitView;
  shouldDelete?: (game: GameView) => boolean;
  allianceID?: number;
  count?: number;
  /**
   * Stable identifier used to collapse repeating events into a single row
   * with a count badge. Two events bundle when their `(type, bundleKey)`
   * pair matches. Derived in {@link onDisplayMessageEvent} from the
   * translation key plus the partner-name parameter, so trade/credit
   * messages whose numeric content (credits, population) varies between
   * occurrences still collapse. Falls back to description equality when
   * absent (e.g. internal alliance-renewal events).
   */
  bundleKey?: string;
}

// How many recent events back the bundler scans for a match. Lets
// repeating messages collapse even when an unrelated event briefly
// interleaves them (e.g. a chat line between two trades).
const BUNDLE_LOOKBACK = 5;

export function EventsDisplay(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick(0);
  const [isVisible, setIsVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [newEvents, setNewEvents] = useState(0);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [eventsFilters, setEventsFilters] = useState<
    Map<MessageCategory, boolean>
  >(
    new Map([
      [MessageCategory.ATTACK, false],
      [MessageCategory.NUKE, false],
      [MessageCategory.TRADE, false],
      [MessageCategory.ALLIANCE, false],
      [MessageCategory.CHAT, false],
    ]),
  );
  const eventsContainerRef = useRef<HTMLDivElement>(null);
  const shouldScrollToBottomRef = useRef(true);
  const alliancesCheckedAtRef = useRef(new Map<number, Tick>());

  // Handle scroll position
  useEffect(() => {
    if (eventsContainerRef.current && shouldScrollToBottomRef.current) {
      const el = eventsContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  // Check scroll position before updates
  useEffect(() => {
    if (eventsContainerRef.current) {
      const el = eventsContainerRef.current;
      shouldScrollToBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 5;
    } else {
      shouldScrollToBottomRef.current = true;
    }
  }, [tick]);

  // Main tick effect - process game updates
  useEffect(() => {
    const myPlayer = gameView.myPlayer();

    if (!isVisible && !gameView.inSpawnPhase()) {
      setIsVisible(true);
    }

    if (!myPlayer || !myPlayer.isAlive()) {
      if (isVisible) {
        setIsVisible(false);
      }
      return;
    }

    // Check for alliance expirations
    const currentAllianceIds = new Set<number>();
    for (const alliance of myPlayer.alliances()) {
      currentAllianceIds.add(alliance.id);

      if (
        alliance.expiresAt >
        gameView.ticks() + gameView.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }

      if (
        (alliancesCheckedAtRef.current.get(alliance.id) ?? 0) >=
        gameView.ticks() - gameView.config().allianceExtensionPromptOffset()
      ) {
        continue;
      }

      alliancesCheckedAtRef.current.set(alliance.id, gameView.ticks());

      const other = gameView.player(alliance.other) as PlayerView;

      addEvent({
        description: translateText("events_display.about_to_expire", {
          name: other.displayName(),
        }),
        type: MessageType.RENEW_ALLIANCE,
        duration: gameView.config().allianceExtensionPromptOffset() - 3 * 10,
        buttons: [
          {
            text: translateText("events_display.focus"),
            className: "btn-gray",
            action: () => eventBus.emit(new GoToPlayerEvent(other)),
            preventClose: true,
          },
          {
            text: translateText("events_display.renew_alliance", {
              name: other.displayName(),
            }),
            className: "btn",
            action: () =>
              eventBus.emit(new SendAllianceExtensionIntentEvent(other)),
          },
          {
            text: translateText("events_display.ignore"),
            className: "btn-info",
            action: () => {},
          },
        ],
        highlight: true,
        createdAt: gameView.ticks(),
        focusID: other.smallID(),
        allianceID: alliance.id,
      });
    }

    for (const [allianceId] of alliancesCheckedAtRef.current) {
      if (!currentAllianceIds.has(allianceId)) {
        removeAllianceRenewalEvents(allianceId);
        alliancesCheckedAtRef.current.delete(allianceId);
      }
    }

    const updates = gameView.updatesSinceLastTick();
    if (updates) {
      // Process various update types
      const displayEvents = updates[GameUpdateType.DisplayEvent] as
        | DisplayMessageUpdate[]
        | undefined;
      if (displayEvents) {
        for (const event of displayEvents) {
          onDisplayMessageEvent(event);
        }
      }
    }

    // Filter out expired events
    let remainingEvents = events.filter((event) => {
      const shouldKeep =
        gameView.ticks() - event.createdAt < (event.duration ?? 600) &&
        !event.shouldDelete?.(gameView);
      if (!shouldKeep && event.onDelete) {
        event.onDelete();
      }
      return shouldKeep;
    });

    if (remainingEvents.length > 30) {
      remainingEvents = remainingEvents.slice(-30);
    }

    if (events.length !== remainingEvents.length) {
      setEvents(remainingEvents);
    }
  }, [tick, gameView, events, isVisible, eventBus]);

  const addEvent = (event: GameEvent) => {
    setEvents((prev) => {
      // Scan the last few events for a bundle match. We look further back
      // than just `prev[prev.length - 1]` so a single interleaved unrelated
      // event doesn't break a streak of repeats. The match prefers the
      // explicit `bundleKey` (which ignores varying numeric content like
      // credit/population amounts) and falls back to description equality for
      // legacy events that don't carry a key.
      if (!event.buttons) {
        const start = Math.max(0, prev.length - BUNDLE_LOOKBACK);
        for (let i = prev.length - 1; i >= start; i--) {
          const candidate = prev[i];
          if (candidate.type !== event.type) continue;
          if (candidate.buttons) continue;
          const matches = event.bundleKey
            ? candidate.bundleKey === event.bundleKey
            : candidate.description === event.description;
          if (!matches) continue;
          // Bundle: pop the matched candidate, replace its description with
          // the latest one (so the visible amount tracks the most recent
          // occurrence), bump the count, and re-append it at the end so the
          // freshest activity stays at the bottom of the feed.
          const updated = prev.slice();
          updated.splice(i, 1);
          updated.push({
            ...candidate,
            description: event.description,
            unsafeDescription: event.unsafeDescription,
            count: (candidate.count ?? 1) + 1,
            createdAt: event.createdAt,
          });
          return updated;
        }
      }
      return [...prev, event];
    });
    if (hidden === true) {
      setNewEvents((prev) => prev + 1);
    }
  };

  const removeAllianceRenewalEvents = (allianceID: number) => {
    setEvents((prev) => prev.filter((e) => e.allianceID !== allianceID));
  };

  const onDisplayMessageEvent = (event: DisplayMessageUpdate) => {
    const myPlayer = gameView.myPlayer();
    if (
      event.playerID !== null &&
      (!myPlayer || myPlayer.smallID() !== event.playerID)
    ) {
      return;
    }

    // Bundle key = translation template + the partner-name parameter when
    // present. Trade messages embed varying credit/population amounts in their
    // description, so the legacy "description equality" check could never
    // collapse them; matching on the (template, partner) pair instead lets
    // a long string of identical-looking trades show up as one row with a
    // count badge.
    const partner = event.params?.name;
    const bundleKey = `${event.message}::${
      typeof partner === "string" ? partner : ""
    }`;

    addEvent({
      description: translateText(event.message, event.params),
      type: event.messageType,
      highlight: true,
      createdAt: gameView.ticks(),
      unsafeDescription: true,
      bundleKey,
    });
  };

  const toggleHidden = () => {
    setHidden((prev) => !prev);
    if (!hidden) {
      setNewEvents(0);
    }
  };

  const toggleEventFilter = (filterName: MessageCategory) => {
    setEventsFilters((prev) => {
      const newFilters = new Map(prev);
      const currentState = newFilters.get(filterName) ?? false;
      newFilters.set(filterName, !currentState);
      return newFilters;
    });
  };

  const renderToggleButton = (src: string, category: MessageCategory) => {
    return (
      <button
        className="cursor-pointer pointer-events-auto"
        onClick={() => toggleEventFilter(category)}
      >
        <img
          src={src}
          className="h-5"
          style={{
            filter: eventsFilters.get(category)
              ? "grayscale(1) opacity(0.5)"
              : "",
          }}
          alt=""
        />
      </button>
    );
  };

  const getEventIconAndColor = (event: GameEvent) => {
    switch (event.type) {
      case MessageType.ALLIANCE_REQUEST:
      case MessageType.ALLIANCE_ACCEPTED:
      case MessageType.ALLIANCE_REJECTED:
      case MessageType.ALLIANCE_BROKEN:
      case MessageType.RENEW_ALLIANCE:
        return { icon: allianceIcon, color: "text-blue-400" };
      case MessageType.ATTACK_FAILED:
      case MessageType.ATTACK_CANCELLED:
        return { icon: swordIcon, color: "text-red-400" };
      case MessageType.NUKE_INBOUND:
      case MessageType.CLUSTER_WARHEAD_INBOUND:
        return { icon: nukeIcon, color: "text-orange-400" };
      case MessageType.SENT_CREDITS_TO_PLAYER:
      case MessageType.RECEIVED_CREDITS_FROM_PLAYER:
        return { icon: donateGoldIcon, color: "text-yellow-400" };
      case MessageType.CHAT:
        return { icon: chatIcon, color: "text-white" };
      default:
        return { icon: chatIcon, color: "text-gray-400" };
    }
  };

  if (!isVisible) {
    return <div />;
  }

  const filteredEvents = events.filter((event) => {
    const category = getMessageCategory(event.type);
    return !eventsFilters.get(category);
  });

  return (
    <div
      className={`pointer-events-auto ${
        hidden ? "w-fit px-2.5 py-1.25" : ""
      } rounded-md bg-black/60 relative max-h-[40vh] flex flex-col overflow-y-auto lg:bottom-2.5 lg:right-2.5 z-50 lg:max-w-[30vw] lg:w-auto w-full`}
    >
      <div className="w-full bg-black/80 sticky top-0 px-2.5 py-1 flex items-center gap-1">
        <button
          className={`text-white cursor-pointer pointer-events-auto ${
            hidden ? "hidden" : ""
          }`}
          onClick={toggleHidden}
        >
          Hide
        </button>

        <button
          className={`text-white cursor-pointer pointer-events-auto ${
            hidden ? "" : "hidden"
          }`}
          onClick={toggleHidden}
        >
          Events
          {newEvents > 0 && (
            <span className="inline-block px-2 bg-red-500 rounded-xs ml-1">
              {newEvents}
            </span>
          )}
        </button>

        <div className="ml-auto flex gap-1">
          {renderToggleButton(swordIcon, MessageCategory.ATTACK)}
          {renderToggleButton(nukeIcon, MessageCategory.NUKE)}
          {renderToggleButton(donateGoldIcon, MessageCategory.TRADE)}
          {renderToggleButton(allianceIcon, MessageCategory.ALLIANCE)}
          {renderToggleButton(chatIcon, MessageCategory.CHAT)}
        </div>
      </div>

      <div
        ref={eventsContainerRef}
        className={`flex flex-col gap-1 overflow-y-auto p-2 ${
          hidden ? "hidden" : ""
        }`}
      >
        {filteredEvents.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-4">
            {translateText("events_display.empty")}
          </div>
        ) : (
          filteredEvents.map((event, idx) => {
            const { icon, color } = getEventIconAndColor(event);
            const sanitized = event.unsafeDescription
              ? DOMPurify.sanitize(onlyImages(event.description))
              : event.description;

            return (
              <div
                key={idx}
                className={`flex items-start gap-2 p-2 bg-gray-800/50 rounded text-xs text-white ${
                  event.highlight ? "border-l-2 border-yellow-400" : ""
                }`}
              >
                <img
                  src={icon}
                  className={`h-4 w-4 shrink-0 ${color}`}
                  alt=""
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {event.unsafeDescription ? (
                      <span dangerouslySetInnerHTML={{ __html: sanitized }} />
                    ) : (
                      <span>{event.description}</span>
                    )}
                    {(event.count ?? 1) > 1 && (
                      <span className="shrink-0 px-1.5 py-0.5 bg-yellow-500/80 text-black font-bold rounded text-[10px] leading-none">
                        {event.count}x
                      </span>
                    )}
                  </div>
                  {event.buttons && event.buttons.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {event.buttons.map((btn, bidx) => (
                        <button
                          key={bidx}
                          className={`px-2 py-1 rounded text-xs whitespace-nowrap ${btn.className}`}
                          onClick={btn.action}
                        >
                          {btn.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
