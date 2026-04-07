import React, { useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { useHUDStore } from "../bridge/HUDStore";
import { useEventBus } from "../bridge/useEventBus";
import { AttackRatioEvent } from "../InputHandler";
import { renderNumber, renderTroops } from "../Utils";
import { useGameTick } from "./useGameTick";

const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const soldierIcon = assetUrl("images/SoldierIcon.svg");
const swordIcon = assetUrl("images/SwordIcon.svg");

export function ControlPanel(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick(100);
  const [isVisible, setIsVisible] = useState(false);
  const [troopData, setTroopData] = useState({
    troops: 0,
    maxTroops: 1,
    troopRate: 0,
    credits: 0n,
    attackingTroops: 0,
    troopRateIsIncreasing: true,
  });
  const [localAttackRatio, setLocalAttackRatio] = useState(0.2);
  const lastTroopRateRef = React.useRef(0);

  // Initialize from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("settings.attackRatio") ?? "0.2";
    const ratio = Number(saved);
    setLocalAttackRatio(ratio);
    useHUDStore.setState({ attackRatio: Math.round(ratio * 100) });
  }, []);

  // Listen to AttackRatioEvent from input handler
  useEventBus(eventBus, AttackRatioEvent, (event) => {
    let newAttackRatio = localAttackRatio + event.attackRatio / 100;

    if (newAttackRatio < 0.01) {
      newAttackRatio = 0.01;
    }
    if (newAttackRatio > 1) {
      newAttackRatio = 1;
    }
    if (newAttackRatio === 0.11 && localAttackRatio === 0.01) {
      newAttackRatio = 0.1;
    }

    setLocalAttackRatio(newAttackRatio);
    localStorage.setItem("settings.attackRatio", String(newAttackRatio));
    useHUDStore.setState({
      attackRatio: Math.round(newAttackRatio * 100),
    });
  });

  // Update on game tick
  useEffect(() => {
    const player = gameView.myPlayer();
    if (!isVisible && !gameView.inSpawnPhase()) {
      setIsVisible(true);
    }

    if (!player || !player.isAlive()) {
      if (isVisible) {
        setIsVisible(false);
      }
      return;
    }

    const troopIncreaseRate = gameView.config().troopIncreaseRate(player);
    const troopRateIsIncreasing = troopIncreaseRate >= lastTroopRateRef.current;
    lastTroopRateRef.current = troopIncreaseRate;

    const outgoingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);

    setTroopData({
      troops: player.troops(),
      maxTroops: gameView.config().maxTroops(player),
      troopRate: gameView.config().troopIncreaseRate(player) * 10,
      credits: player.credits(),
      attackingTroops: outgoingTroops,
      troopRateIsIncreasing,
    });
  }, [tick, gameView, isVisible]);

  const calculateTroopBar = () => {
    const base = Math.max(troopData.maxTroops, 1);
    const greenPercentRaw = (troopData.troops / base) * 100;
    const orangePercentRaw = (troopData.attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return { greenPercent, orangePercent };
  };

  const handleRatioSliderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.currentTarget.value);
    const newRatio = value / 100;
    setLocalAttackRatio(newRatio);
    localStorage.setItem("settings.attackRatio", String(newRatio));
    useHUDStore.setState({ attackRatio: value });
  };

  const handleRatioSliderPointerUp = (
    e: React.PointerEvent<HTMLInputElement>,
  ) => {
    e.currentTarget.blur();
  };

  if (!isVisible) {
    return <div className="hidden" />;
  }

  const { greenPercent, orangePercent } = calculateTroopBar();
  const player = gameView.myPlayer();
  const currentTroops = player?.troops() ?? 0;

  return (
    <div
      className="relative pointer-events-auto w-full text-sm px-2 py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Mobile render */}
      <div className="lg:hidden">
        <div className="flex gap-2 items-center">
          {/* Gold */}
          <div
            className="flex items-center justify-center p-1 gap-0.5 border rounded-md border-yellow-400 font-bold text-yellow-400 text-xs w-1/5 shrink-0"
            translate="no"
          >
            <img src={goldCoinIcon} width="13" height="13" alt="" />
            <span className="px-0.5">{renderNumber(troopData.credits)}</span>
          </div>
          {/* Troop bar */}
          <div className="w-[40%] shrink-0 flex items-center">
            <div className="w-full h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative">
              <div className="h-full flex">
                {greenPercent > 0 && (
                  <div
                    className="h-full bg-sky-700 transition-[width] duration-200"
                    style={{ width: `${greenPercent}%` }}
                  />
                )}
                {orangePercent > 0 && (
                  <div
                    className="h-full bg-sky-600 transition-[width] duration-200"
                    style={{ width: `${orangePercent}%` }}
                  />
                )}
              </div>
              <div
                className="absolute inset-0 flex items-center justify-between px-1.5 text-xs font-bold leading-none pointer-events-none"
                translate="no"
              >
                <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                  {renderTroops(troopData.troops)}
                </span>
                <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                  {renderTroops(troopData.maxTroops)}
                </span>
              </div>
              <div
                className="absolute inset-0 flex items-center justify-center gap-0.5 pointer-events-none"
                translate="no"
              >
                <img
                  src={soldierIcon}
                  alt=""
                  aria-hidden="true"
                  width="12"
                  height="12"
                  className="brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
                />
                <span
                  className={`text-[10px] font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${
                    troopData.troopRateIsIncreasing
                      ? "text-green-400"
                      : "text-orange-400"
                  }`}
                >
                  +{renderTroops(troopData.troopRate)}/s
                </span>
              </div>
            </div>
          </div>
          {/* Sword + % label */}
          <div
            className="flex flex-col items-center shrink-0 gap-0.5 w-8"
            translate="no"
          >
            <img
              src={swordIcon}
              alt=""
              aria-hidden="true"
              width="10"
              height="10"
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <span className="text-white text-xs font-bold tabular-nums">
              {(localAttackRatio * 100).toFixed(0)}%
            </span>
          </div>
          {/* Attack ratio slider */}
          <div className="flex-1" translate="no">
            <input
              type="range"
              min="1"
              max="100"
              value={Math.round(localAttackRatio * 100)}
              onChange={handleRatioSliderInput}
              onPointerUp={handleRatioSliderPointerUp}
              className="w-full h-1.5 accent-blue-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Desktop render */}
      <div className="hidden lg:block">
        {/* Row 1: troop rate | troop bar | gold */}
        <div className="flex gap-1.5 items-center mb-1">
          {/* Troop rate */}
          <div
            className={`flex items-center gap-1 shrink-0 border rounded-md font-bold text-sm py-0.5 px-1 w-[5.5rem] ${
              troopData.troopRateIsIncreasing
                ? "border-green-400"
                : "border-orange-400"
            }`}
            translate="no"
          >
            <img
              src={soldierIcon}
              alt=""
              aria-hidden="true"
              width="13"
              height="13"
              className="shrink-0"
              style={{
                filter: troopData.troopRateIsIncreasing
                  ? "brightness(0) saturate(100%) invert(74%) sepia(44%) saturate(500%) hue-rotate(83deg) brightness(103%)"
                  : "brightness(0) saturate(100%) invert(65%) sepia(60%) saturate(600%) hue-rotate(330deg) brightness(105%)",
              }}
            />
            <span
              className={`text-sm font-bold tabular-nums ${
                troopData.troopRateIsIncreasing
                  ? "text-green-400"
                  : "text-orange-400"
              }`}
            >
              +{renderTroops(troopData.troopRate)}/s
            </span>
          </div>
          {/* Troop bar */}
          <div className="flex-1">
            <div className="w-full h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative">
              <div className="h-full flex">
                {greenPercent > 0 && (
                  <div
                    className="h-full bg-sky-700 transition-[width] duration-200"
                    style={{ width: `${greenPercent}%` }}
                  />
                )}
                {orangePercent > 0 && (
                  <div
                    className="h-full bg-sky-600 transition-[width] duration-200"
                    style={{ width: `${orangePercent}%` }}
                  />
                )}
              </div>
              <div
                className="absolute inset-0 flex items-center text-lg font-bold leading-none pointer-events-none"
                translate="no"
              >
                <span className="flex-1 flex justify-end h-full items-center pr-0.5">
                  <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                    {renderTroops(troopData.troops)}
                  </span>
                </span>
                <span className="h-full flex items-center px-0.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                  /
                </span>
                <span className="flex-1 flex justify-start h-full items-center pl-0.5 gap-0.5">
                  <span className="text-white tabular-nums w-[3.5rem] drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                    {renderTroops(troopData.maxTroops)}
                  </span>
                  <img
                    src={soldierIcon}
                    alt=""
                    aria-hidden="true"
                    width="22"
                    height="22"
                    className="shrink-0 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ml-1.5"
                  />
                </span>
              </div>
            </div>
          </div>
          {/* Gold */}
          <div
            className="flex items-center gap-1 shrink-0 border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm py-0.5 px-1 w-[4.5rem]"
            translate="no"
          >
            <img
              src={goldCoinIcon}
              width="13"
              height="13"
              className="shrink-0"
              alt=""
            />
            <span className="tabular-nums">
              {renderNumber(troopData.credits)}
            </span>
          </div>
        </div>
        {/* Row 2: attack ratio | slider */}
        <div className="flex items-center gap-1.5" translate="no">
          <div className="flex items-center gap-1 shrink-0 border border-gray-600 rounded-md px-1 py-0.5 text-sm font-bold text-white cursor-pointer w-[8rem]">
            <img
              src={swordIcon}
              alt=""
              aria-hidden="true"
              width="12"
              height="12"
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <span>
              {(localAttackRatio * 100).toFixed(0)}% (
              {renderTroops(currentTroops * localAttackRatio)})
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={Math.round(localAttackRatio * 100)}
            onChange={handleRatioSliderInput}
            onPointerUp={handleRatioSliderPointerUp}
            className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
