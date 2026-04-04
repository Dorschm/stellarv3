import { useEffect } from "react";
import {
  EventBus,
  EventConstructor,
  GameEvent,
} from "../../core/EventBus";

/**
 * React hook that subscribes to an {@link EventBus} event for the lifetime
 * of the calling component.  Automatically calls `off()` on unmount.
 *
 * @param eventBus  The shared EventBus instance (from {@link useGameView}).
 * @param eventType The event class constructor to listen for.
 * @param callback  Handler invoked each time the event fires.
 *
 * @example
 * ```tsx
 * const { eventBus } = useGameView();
 * useEventBus(eventBus, MouseUpEvent, (e) => {
 *   console.log("clicked at", e.x, e.y);
 * });
 * ```
 */
export function useEventBus<T extends GameEvent>(
  eventBus: EventBus,
  eventType: EventConstructor<T>,
  callback: (event: T) => void,
): void {
  useEffect(() => {
    eventBus.on(eventType, callback);
    return () => {
      eventBus.off(eventType, callback);
    };
    // We intentionally depend on the identity of all three arguments so the
    // subscription is re-created if the bus, event class, or handler changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventBus, eventType, callback]);
}
