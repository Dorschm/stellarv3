import React, { useState, useCallback, useEffect, useRef } from "react";
import { GameEnv } from "../../core/configuration/Config";
import { GameType } from "../../core/game/Game";
import { MultiTabDetector } from "../MultiTabDetector";
import { translateText } from "../Utils";
import { useGameTick } from "./useGameTick";

export function MultiTabModal(): React.JSX.Element {
  const { gameView } = useGameTick(100);
  const [isVisible, setIsVisible] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [fakeIp, setFakeIp] = useState("");
  const [deviceFingerprint, setDeviceFingerprint] = useState("");
  const [reported, setReported] = useState(true);
  const [duration, setDuration] = useState(5000);

  const detectorRef = useRef<MultiTabDetector | null>(null);
  const intervalIdRef = useRef<number | undefined>(undefined);

  // Generate fake IP in format xxx.xxx.xxx.xxx
  const generateFakeIp = useCallback(() => {
    return Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * 255),
    ).join(".");
  }, []);

  // Generate fake device fingerprint (32 character hex)
  const generateDeviceFingerprint = useCallback(() => {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }, []);

  // Initialize detector on mount
  useEffect(() => {
    setFakeIp(generateFakeIp());
    setDeviceFingerprint(generateDeviceFingerprint());
    setReported(true);
  }, [generateFakeIp, generateDeviceFingerprint]);

  // Initialize multi-tab monitoring
  useEffect(() => {
    if (
      gameView.inSpawnPhase() ||
      gameView.config().gameConfig().gameType === GameType.Singleplayer ||
      gameView.config().serverConfig().env() === GameEnv.Dev ||
      gameView.config().isReplay()
    ) {
      return;
    }

    if (!detectorRef.current) {
      detectorRef.current = new MultiTabDetector();
      detectorRef.current.startMonitoring((detectedDuration: number) => {
        show(detectedDuration);
      });
    }
  }, [gameView]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalIdRef.current) {
        window.clearInterval(intervalIdRef.current);
      }
    };
  }, []);

  const hide = useCallback(() => {
    setIsVisible(false);

    if (intervalIdRef.current) {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = undefined;
    }

    // Dispatch event when modal is closed
    dispatchEvent(
      new CustomEvent("penalty-complete", {
        bubbles: true,
        composed: true,
      }),
    );
  }, []);

  const show = useCallback((detectedDuration: number) => {
    if (!gameView.myPlayer()?.isAlive()) {
      return;
    }

    setDuration(detectedDuration);
    setCountdown(Math.ceil(detectedDuration / 1000));
    setIsVisible(true);

    // Start countdown timer
    intervalIdRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        const newCountdown = prev - 1;

        if (newCountdown <= 0) {
          hide();
        }

        return newCountdown;
      });
    }, 1000);
  }, [gameView, hide]);

  if (!isVisible) {
    return null as any;
  }

  const progressWidth = (countdown / (duration / 1000)) * 100;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-red-500/20 flex items-center justify-center">
      <div className="relative p-6 bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full m-4 transition-all transform">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-400">
            {translateText("multi_tab.warning")}
          </h2>
          <div className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse">
            RECORDING
          </div>
        </div>

        <p className="mb-4 text-gray-800 dark:text-gray-200">
          {translateText("multi_tab.detected")}
        </p>

        <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-900 rounded-md text-sm font-mono">
          <div className="flex justify-between mb-1">
            <span className="text-gray-500 dark:text-gray-400">IP:</span>
            <span className="text-red-600 dark:text-red-400">{fakeIp}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-500 dark:text-gray-400">
              Device Fingerprint:
            </span>
            <span className="text-red-600 dark:text-red-400">
              {deviceFingerprint}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Reported:</span>
            <span className="text-red-600 dark:text-red-400">
              {reported ? "TRUE" : "FALSE"}
            </span>
          </div>
        </div>

        <p className="mb-4 text-gray-800 dark:text-gray-200">
          {translateText("multi_tab.please_wait")}
          <span className="font-bold text-xl ml-1">{countdown}</span>
          {translateText("multi_tab.seconds")}
        </p>

        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-4">
          <div
            className="bg-red-600 dark:bg-red-500 h-2.5 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${progressWidth}%` }}
          ></div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {translateText("multi_tab.explanation")}
        </p>

        <p className="mt-3 text-xs text-red-500 font-semibold">
          Repeated violations may result in permanent account suspension.
        </p>
      </div>
    </div>
  );
}

export default MultiTabModal;
