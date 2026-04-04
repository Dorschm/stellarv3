import { useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../../core/EventBus";
import { GameView } from "../../core/game/GameView";
import { TickMetricsEvent } from "../InputHandler";
import { useGameView } from "../bridge/GameViewContext";

/**
 * React hook that re-renders the component on game ticks, with optional throttling.
 * Replaces the Lit Layer.tick() + getTickIntervalMs() pattern.
 *
 * @param intervalMs Minimum ms between re-renders. 0 = every tick. Default 0.
 * @returns { gameView, eventBus, tick } where tick is an incrementing counter.
 */
export function useGameTick(intervalMs: number = 0): {
  gameView: GameView;
  eventBus: EventBus;
  tick: number;
} {
  const { gameView, eventBus } = useGameView();
  const [tick, setTick] = useState(0);
  const lastUpdateRef = useRef(0);

  const onTick = useCallback(() => {
    if (intervalMs <= 0) {
      setTick((t) => t + 1);
      return;
    }
    const now = performance.now();
    if (now - lastUpdateRef.current >= intervalMs) {
      lastUpdateRef.current = now;
      setTick((t) => t + 1);
    }
  }, [intervalMs]);

  useEffect(() => {
    eventBus.on(TickMetricsEvent, onTick);
    return () => {
      eventBus.off(TickMetricsEvent, onTick);
    };
  }, [eventBus, onTick]);

  return { gameView, eventBus, tick };
}
