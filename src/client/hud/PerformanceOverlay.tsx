import React, { useEffect, useRef, useState } from "react";
import { EventBus } from "../../core/EventBus";
import { UserSettings } from "../../core/game/UserSettings";
import { TickMetricsEvent, TogglePerformanceOverlayEvent } from "../InputHandler";
import { translateText } from "../Utils";
import { useGameView } from "../bridge/GameViewContext";

export function PerformanceOverlay(): React.JSX.Element {
  const { eventBus } = useGameView();
  const userSettings = new UserSettings();

  const [isVisible, setIsVisible] = useState(false);
  const [currentFPS, setCurrentFPS] = useState(0);
  const [averageFPS, setAverageFPS] = useState(0);
  const [frameTime, setFrameTime] = useState(0);
  const [currentTPS, setCurrentTPS] = useState(0);
  const [averageTPS, setAverageTPS] = useState(0);
  const [tickExecutionAvg, setTickExecutionAvg] = useState(0);
  const [tickExecutionMax, setTickExecutionMax] = useState(0);
  const [tickDelayAvg, setTickDelayAvg] = useState(0);
  const [tickDelayMax, setTickDelayMax] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );

  // Tracking refs
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);
  const frameTimesRef = useRef<number[]>([]);
  const frameTimesSumRef = useRef(0);
  const fpsHistoryRef = useRef<number[]>([]);
  const fpsHistorySumRef = useRef(0);
  const lastSecondTimeRef = useRef(0);
  const framesThisSecondRef = useRef(0);
  const tickExecutionTimesRef = useRef<number[]>([]);
  const tickExecutionTimesSumRef = useRef(0);
  const tickDelayTimesRef = useRef<number[]>([]);
  const tickDelayTimesSumRef = useRef(0);
  const tickTimestampsRef = useRef<number[]>([]);
  const tickHead1sRef = useRef(0);
  const tickHead60sRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    dragStart: { x: number; y: number };
  } | null>(null);
  const copyStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const onTogglePerformanceOverlay = (
    _event: TogglePerformanceOverlayEvent
  ) => {
    const nextVisible = !isVisible;
    setIsVisible(nextVisible);
    userSettings.set("settings.performanceOverlay", nextVisible);
  };

  const onTickMetricsEvent = (event: TickMetricsEvent) => {
    updateTickMetrics(event.tickExecutionDuration, event.tickDelay);
  };

  useEffect(() => {
    setIsVisible(userSettings.performanceOverlay());

    eventBus.on(TogglePerformanceOverlayEvent, onTogglePerformanceOverlay);
    eventBus.on(TickMetricsEvent, onTickMetricsEvent);

    return () => {
      eventBus.off(TogglePerformanceOverlayEvent, onTogglePerformanceOverlay);
      eventBus.off(TickMetricsEvent, onTickMetricsEvent);
    };
  }, [eventBus, isVisible]);

  // FPS measurement via requestAnimationFrame
  useEffect(() => {
    if (!isVisible) return;

    let rafId: number;
    const measure = (now: number) => {
      frameCountRef.current++;
      framesThisSecondRef.current++;

      // Per-frame time
      if (lastTimeRef.current > 0) {
        const delta = now - lastTimeRef.current;
        frameTimesRef.current.push(delta);
        frameTimesSumRef.current += delta;
        if (frameTimesRef.current.length > 60) {
          const removed = frameTimesRef.current.shift()!;
          frameTimesSumRef.current -= removed;
        }
        setFrameTime(
          Math.round(
            (frameTimesSumRef.current / frameTimesRef.current.length) * 100,
          ) / 100,
        );
      }
      lastTimeRef.current = now;

      // Per-second FPS
      if (lastSecondTimeRef.current === 0) {
        lastSecondTimeRef.current = now;
      }
      if (now - lastSecondTimeRef.current >= 1000) {
        const fps = framesThisSecondRef.current;
        setCurrentFPS(fps);

        fpsHistoryRef.current.push(fps);
        fpsHistorySumRef.current += fps;
        if (fpsHistoryRef.current.length > 60) {
          const removed = fpsHistoryRef.current.shift()!;
          fpsHistorySumRef.current -= removed;
        }
        setAverageFPS(
          Math.round(
            (fpsHistorySumRef.current / fpsHistoryRef.current.length) * 10,
          ) / 10,
        );

        framesThisSecondRef.current = 0;
        lastSecondTimeRef.current = now;
      }

      rafId = requestAnimationFrame(measure);
    };

    rafId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(rafId);
  }, [isVisible]);

  const updateTickMetrics = (
    tickExecutionDuration?: number,
    tickDelay?: number
  ) => {
    if (!isVisible) return;

    const now = performance.now();
    tickTimestampsRef.current.push(now);

    while (
      tickHead1sRef.current < tickTimestampsRef.current.length &&
      now - tickTimestampsRef.current[tickHead1sRef.current] > 1000
    ) {
      tickHead1sRef.current++;
    }
    while (
      tickHead60sRef.current < tickTimestampsRef.current.length &&
      now - tickTimestampsRef.current[tickHead60sRef.current] > 60000
    ) {
      tickHead60sRef.current++;
    }

    const ticksLast1s =
      tickTimestampsRef.current.length - tickHead1sRef.current;
    const ticksLast60s =
      tickTimestampsRef.current.length - tickHead60sRef.current;
    setCurrentTPS(ticksLast1s);

    const oldest60 =
      ticksLast60s > 0
        ? tickTimestampsRef.current[tickHead60sRef.current]
        : now;
    const elapsed60s = Math.min(
      60,
      Math.max(1, (now - oldest60) / 1000)
    );
    setAverageTPS(Math.round((ticksLast60s / elapsed60s) * 10) / 10);

    // Compact occasionally to avoid unbounded growth
    if (tickHead60sRef.current > 4000) {
      tickTimestampsRef.current = tickTimestampsRef.current.slice(
        tickHead60sRef.current
      );
      tickHead1sRef.current = Math.max(0, tickHead1sRef.current - tickHead60sRef.current);
      tickHead60sRef.current = 0;
    }

    // Update tick execution duration stats
    if (tickExecutionDuration !== undefined) {
      tickExecutionTimesRef.current.push(tickExecutionDuration);
      tickExecutionTimesSumRef.current += tickExecutionDuration;
      if (tickExecutionTimesRef.current.length > 60) {
        const removed = tickExecutionTimesRef.current.shift();
        if (removed !== undefined)
          tickExecutionTimesSumRef.current -= removed;
      }

      if (tickExecutionTimesRef.current.length > 0) {
        const avg =
          tickExecutionTimesSumRef.current / tickExecutionTimesRef.current.length;
        setTickExecutionAvg(Math.round(avg * 100) / 100);
        let max = 0;
        for (const v of tickExecutionTimesRef.current) max = Math.max(max, v);
        setTickExecutionMax(Math.round(max));
      }
    }

    // Update tick delay stats
    if (tickDelay !== undefined) {
      tickDelayTimesRef.current.push(tickDelay);
      tickDelayTimesSumRef.current += tickDelay;
      if (tickDelayTimesRef.current.length > 60) {
        const removed = tickDelayTimesRef.current.shift();
        if (removed !== undefined) tickDelayTimesSumRef.current -= removed;
      }

      if (tickDelayTimesRef.current.length > 0) {
        const avg =
          tickDelayTimesSumRef.current / tickDelayTimesRef.current.length;
        setTickDelayAvg(Math.round(avg * 100) / 100);
        let max = 0;
        for (const v of tickDelayTimesRef.current) max = Math.max(max, v);
        setTickDelayMax(Math.round(max));
      }
    }
  };

  const handleReset = () => {
    frameCountRef.current = 0;
    lastTimeRef.current = 0;
    frameTimesRef.current = [];
    frameTimesSumRef.current = 0;
    fpsHistoryRef.current = [];
    fpsHistorySumRef.current = 0;
    lastSecondTimeRef.current = 0;
    framesThisSecondRef.current = 0;
    setCurrentFPS(0);
    setAverageFPS(0);
    setFrameTime(0);

    tickExecutionTimesRef.current = [];
    tickDelayTimesRef.current = [];
    tickExecutionTimesSumRef.current = 0;
    tickDelayTimesSumRef.current = 0;
    setTickExecutionAvg(0);
    setTickExecutionMax(0);
    setTickDelayAvg(0);
    setTickDelayMax(0);
    setCurrentTPS(0);
    setAverageTPS(0);
    tickTimestampsRef.current = [];
    tickHead1sRef.current = 0;
    tickHead60sRef.current = 0;
  };

  const handleClose = () => {
    setIsVisible(false);
    userSettings.set("settings.performanceOverlay", false);
  };

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    dragStateRef.current = {
      pointerId: e.pointerId,
      dragStart: {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      },
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragStateRef.current || e.pointerId !== dragStateRef.current.pointerId)
        return;

      const newX = e.clientX - dragStateRef.current.dragStart.x;
      const newY = e.clientY - dragStateRef.current.dragStart.y;

      const margin = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      setPosition({
        x: Math.max(margin, Math.min(viewportWidth - 100 - margin, newX)),
        y: Math.max(margin, Math.min(viewportHeight - 100, newY)),
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragStateRef.current || e.pointerId !== dragStateRef.current.pointerId)
        return;

      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
      globalThis.removeEventListener("pointercancel", onPointerUp);

      dragStateRef.current = null;
      setIsDragging(false);
    };

    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerUp);
    globalThis.addEventListener("pointercancel", onPointerUp);
  };

  const handleCopyJson = async () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      fps: {
        current: currentFPS,
        average60s: averageFPS,
        frameTimeMs: frameTime,
      },
      tps: {
        current: currentTPS,
        average60s: averageTPS,
      },
      ticks: {
        executionAvgMs: tickExecutionAvg,
        executionMaxMs: tickExecutionMax,
        delayAvgMs: tickDelayAvg,
        delayMaxMs: tickDelayMax,
      },
    };

    const json = JSON.stringify(snapshot, null, 2);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = json;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }

    if (copyStatusTimeoutRef.current) {
      clearTimeout(copyStatusTimeoutRef.current);
    }

    copyStatusTimeoutRef.current = setTimeout(() => {
      setCopyStatus("idle");
      copyStatusTimeoutRef.current = null;
    }, 2000);
  };

  const getPerformanceColor = (fps: number): string => {
    if (fps >= 55) return "text-green-400";
    if (fps >= 30) return "text-yellow-400";
    return "text-red-400";
  };

  const getTPSColor = (tps: number): string => {
    if (tps >= 18) return "text-green-400";
    if (tps >= 10) return "text-yellow-400";
    return "text-red-400";
  };

  if (!isVisible) {
    return <></>;
  }

  const copyLabel =
    copyStatus === "success"
      ? translateText("performance_overlay.copied")
      : copyStatus === "error"
        ? translateText("performance_overlay.failed_copy")
        : translateText("performance_overlay.copy_clipboard");

  return (
    <div
      className={`fixed bg-black/80 text-white p-8 rounded font-mono text-sm z-9999 user-select-none ${isDragging ? "opacity-50" : ""}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        minWidth: "300px",
      }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-8 cursor-grab active:cursor-grabbing"
        onPointerDown={handleDragPointerDown}
      />

      <button
        className="absolute top-2 left-2 h-5 px-2 bg-black/80 rounded text-white text-xs border-none cursor-pointer"
        onClick={handleReset}
      >
        {translateText("performance_overlay.reset")}
      </button>

      <button
        className="absolute top-2 left-20 h-5 px-2 bg-black/80 rounded text-white text-xs border-none cursor-pointer"
        onClick={handleCopyJson}
        title={translateText("performance_overlay.copy_json_title")}
      >
        {copyLabel}
      </button>

      <button
        className="absolute top-2 right-2 w-5 h-5 bg-black/80 rounded text-white text-lg font-bold cursor-pointer border-none flex items-center justify-center"
        onClick={handleClose}
      >
        ×
      </button>

      <div style={{ marginTop: "32px" }}>
        <div className="mb-1">
          {translateText("performance_overlay.fps")}{" "}
          <span className={getPerformanceColor(currentFPS)}>
            {currentFPS}
          </span>
        </div>
        <div className="mb-1">
          {translateText("performance_overlay.avg_60s")}{" "}
          <span className={getPerformanceColor(averageFPS)}>
            {averageFPS}
          </span>
        </div>
        <div className="mb-1">
          {translateText("performance_overlay.frame")}{" "}
          <span className={getPerformanceColor(frameTime > 0 ? 1000 / frameTime : 0)}>
            {frameTime}ms
          </span>
        </div>
        <div className="mb-1">
          {translateText("performance_overlay.tps")}{" "}
          <span className={getTPSColor(currentTPS)}>{currentTPS}</span>
          ({translateText("performance_overlay.tps_avg_60s")}{" "}
          <span>{averageTPS}</span>)
        </div>
        <div className="mb-1">
          {translateText("performance_overlay.tick_exec")}{" "}
          <span>{tickExecutionAvg.toFixed(2)}ms</span>
          ({translateText("performance_overlay.max_label")}{" "}
          <span>{tickExecutionMax}ms</span>)
        </div>
        <div className="mb-1">
          {translateText("performance_overlay.tick_delay")}{" "}
          <span>{tickDelayAvg.toFixed(2)}ms</span>
          ({translateText("performance_overlay.max_label")}{" "}
          <span>{tickDelayMax}ms</span>)
        </div>
      </div>
    </div>
  );
}

export default PerformanceOverlay;
