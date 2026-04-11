import React, { useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { PlayerType, Relation, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { PlayerView, UnitView } from "../../core/game/GameView";
import { useGameView } from "../bridge/GameViewContext";
import { useEventBus } from "../bridge/useEventBus";
import { ContextMenuEvent, TileHoverEvent, TouchEvent } from "../InputHandler";
import {
  getTranslatedPlayerTeamLabel,
  renderNumber,
  renderPopulation,
  translateText,
} from "../Utils";
import {
  CloseRadialMenuEvent,
  ImmunityBarVisibleEvent,
  SpawnBarVisibleEvent,
} from "./events";
import { useGameTick } from "./useGameTick";

const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const soldierIcon = assetUrl("images/SoldierIcon.svg");

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  gameView: any,
): number {
  const x = gameView.x(tileRef);
  const y = gameView.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(coord: { x: number; y: number }, gameView: any) {
  return (a: UnitView, b: UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), gameView);
    const distB = euclideanDistWorld(coord, b.tile(), gameView);
    return distA - distB;
  };
}

export function PlayerInfoOverlay(): React.JSX.Element {
  const { eventBus } = useGameView();
  const { gameView } = useGameTick();
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [playerProfile, setPlayerProfile] = useState<any | null>(null);
  const [unit, setUnit] = useState<UnitView | null>(null);
  const [isInfoVisible, setIsInfoVisible] = useState(false);
  const [spawnBarVisible, setSpawnBarVisible] = useState(false);
  const [immunityBarVisible, setImmunityBarVisible] = useState(false);
  const [barOffset, setBarOffset] = useState(0);

  const lastMouseUpdateRef = React.useRef(0);

  const barOffsetValue =
    (spawnBarVisible ? 7 : 0) + (immunityBarVisible ? 7 : 0);

  useEffect(() => {
    setBarOffset(barOffsetValue);
  }, [barOffsetValue]);

  useEventBus(eventBus, TileHoverEvent, (e: TileHoverEvent) => {
    const now = Date.now();
    if (now - lastMouseUpdateRef.current < 100) {
      return;
    }
    lastMouseUpdateRef.current = now;
    maybeShowTile(e.tileX, e.tileY);
  });

  useEventBus(eventBus, ContextMenuEvent, (e: ContextMenuEvent) => {
    maybeShowTile(e.x, e.y);
  });

  useEventBus(eventBus, TouchEvent, (e: TouchEvent) => {
    maybeShowTile(e.x, e.y);
  });

  useEventBus(eventBus, CloseRadialMenuEvent, () => {
    hide();
  });

  useEventBus(eventBus, SpawnBarVisibleEvent, (e) => {
    setSpawnBarVisible(e.visible);
  });

  useEventBus(eventBus, ImmunityBarVisibleEvent, (e) => {
    setImmunityBarVisible(e.visible);
  });

  const hide = () => {
    setIsInfoVisible(false);
    setUnit(null);
    setPlayer(null);
  };

  const maybeShowTile = (tileX: number, tileY: number) => {
    hide();
    if (!gameView.isValidCoord(tileX, tileY)) {
      return;
    }

    const tile = gameView.ref(tileX, tileY);
    if (!tile) return;

    const coord = { x: tileX, y: tileY };
    const owner = gameView.owner(tile);

    if (owner && owner.isPlayer()) {
      setPlayer(owner as PlayerView);
      (owner as PlayerView).profile().then((p: any) => {
        setPlayerProfile(p);
      });
      setIsInfoVisible(true);
    } else if (!gameView.isSector(tile)) {
      const units = gameView
        .units(
          UnitType.Battlecruiser,
          UnitType.TradeFreighter,
          UnitType.AssaultShuttle,
        )
        .filter((u) => euclideanDistWorld(coord, u.tile(), gameView) < 50)
        .sort(distSortUnitWorld(coord, gameView));

      if (units.length > 0) {
        setUnit(units[0]);
        setIsInfoVisible(true);
      }
    }
  };

  const getPlayerNameColor = (
    playerInfo: PlayerView,
    myPlayer: PlayerView | null | undefined,
    isFriendly: boolean,
  ): string => {
    if (isFriendly) return "text-green-500";
    if (
      myPlayer &&
      myPlayer !== playerInfo &&
      playerInfo.type() === PlayerType.Nation
    ) {
      const relation =
        playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
      return getRelationClass(relation);
    }
    return "text-white";
  };

  const getRelationClass = (relation: Relation): string => {
    switch (relation) {
      case Relation.Hostile:
        return "text-red-500";
      case Relation.Distrustful:
        return "text-red-300";
      case Relation.Neutral:
        return "text-white";
      case Relation.Friendly:
        return "text-green-500";
      default:
        return "text-white";
    }
  };

  const displayUnitCount = (
    playerInfo: PlayerView,
    type: UnitType,
    icon: string,
  ) => {
    return !gameView.config().isUnitDisabled(type)
      ? `<div class="flex items-center justify-center gap-0.5 lg:gap-1 p-0.5 lg:p-1 border rounded-md border-gray-500 text-[10px] lg:text-xs w-9 lg:w-12 h-6 lg:h-7" translate="no">
          <img src="${icon}" class="w-3 h-3 lg:w-4 lg:h-4 object-contain shrink-0" />
          <span>${playerInfo.totalUnitLevels(type)}</span>
        </div>`
      : "";
  };

  const renderPlayerInfo = (playerInfo: PlayerView) => {
    const myPlayer = gameView.myPlayer();
    const isFriendly = myPlayer?.isFriendly(playerInfo);
    const maxPopulation = gameView.config().maxPopulation(playerInfo);
    const attackingPopulation = playerInfo
      .outgoingAttacks()
      .map((a) => a.population)
      .reduce((a, b) => a + b, 0);
    const totalPopulation = playerInfo.population();

    let playerType = "";
    switch (playerInfo.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_type.bot");
        break;
      case PlayerType.Nation:
        playerType = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_type.player");
        break;
    }
    const playerTeam = getTranslatedPlayerTeamLabel(playerInfo.team());

    return (
      <div className="flex items-start gap-1 lg:gap-2 p-1 lg:p-1.5">
        {/* Left: Credits & Population bar */}
        <div className="flex flex-col gap-1 shrink-0 w-28 md:w-36">
          <div className="flex items-center gap-1">
            <div
              className="flex flex-1 items-center justify-center px-1 py-0.5 border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm lg:gap-1"
              translate="no"
            >
              <img src={goldCoinIcon} width="13" height="13" alt="" />
              <span className="px-0.5">
                {renderNumber(Number(playerInfo.credits()))}
              </span>
            </div>
            <div
              className={`flex flex-1 flex-col items-center justify-center text-xs font-bold ${
                attackingPopulation > 0 ? "text-sky-400" : "text-white/40"
              } drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]`}
              translate="no"
            >
              <span className="flex items-center gap-px leading-none text-xs">
                <img
                  src={soldierIcon}
                  className="w-2.5 h-2.5"
                  style={{
                    filter:
                      attackingPopulation > 0
                        ? "brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%)"
                        : "brightness(0) invert(1)",
                    opacity: attackingPopulation > 0 ? 1 : 0.4,
                  }}
                  alt=""
                />
                ↑
              </span>
              <span className="tabular-nums leading-none text-sm mt-0.5">
                {renderPopulation(attackingPopulation)}
              </span>
            </div>
          </div>
          <div className="w-28 md:w-36" translate="no">
            {renderTroopBar(
              totalPopulation,
              attackingPopulation,
              maxPopulation,
            )}
          </div>
        </div>

        {/* Right: Player identity */}
        <div className="flex flex-col justify-between self-stretch">
          <div
            className={`flex items-center gap-2 font-bold text-sm lg:text-lg ${getPlayerNameColor(playerInfo, myPlayer, isFriendly ?? false)}`}
          >
            {playerInfo.cosmetics.flag ? (
              <img
                className="h-6 object-contain"
                src={assetUrl(playerInfo.cosmetics.flag)}
                alt=""
              />
            ) : null}
            <span>{playerInfo.displayName()}</span>
            {playerTeam !== "" && playerInfo.type() !== PlayerType.Bot ? (
              <div className="flex flex-col leading-tight">
                <span className="text-gray-400 text-xs font-normal">
                  {playerType}
                </span>
                <span className="text-xs font-normal text-gray-400">
                  [
                  <span
                    style={{
                      color: gameView
                        .config()
                        .theme()
                        .teamColor(playerInfo.team()!)
                        .toHex(),
                    }}
                  >
                    {playerTeam}
                  </span>
                  ]
                </span>
              </div>
            ) : (
              <span className="text-gray-400 text-xs font-normal">
                {playerType}
              </span>
            )}
          </div>
          <div className="flex gap-0.5 lg:gap-1 items-center mt-0.5">
            {displayUnitCount(playerInfo, UnitType.Colony, cityIcon) && (
              <div
                dangerouslySetInnerHTML={{
                  __html: displayUnitCount(
                    playerInfo,
                    UnitType.Colony,
                    cityIcon,
                  ),
                }}
              />
            )}
            {displayUnitCount(playerInfo, UnitType.Foundry, factoryIcon) && (
              <div
                dangerouslySetInnerHTML={{
                  __html: displayUnitCount(
                    playerInfo,
                    UnitType.Foundry,
                    factoryIcon,
                  ),
                }}
              />
            )}
            {displayUnitCount(playerInfo, UnitType.Spaceport, portIcon) && (
              <div
                dangerouslySetInnerHTML={{
                  __html: displayUnitCount(
                    playerInfo,
                    UnitType.Spaceport,
                    portIcon,
                  ),
                }}
              />
            )}
            {displayUnitCount(
              playerInfo,
              UnitType.OrbitalStrikePlatform,
              missileSiloIcon,
            ) && (
              <div
                dangerouslySetInnerHTML={{
                  __html: displayUnitCount(
                    playerInfo,
                    UnitType.OrbitalStrikePlatform,
                    missileSiloIcon,
                  ),
                }}
              />
            )}
            {displayUnitCount(
              playerInfo,
              UnitType.PointDefenseArray,
              samLauncherIcon,
            ) && (
              <div
                dangerouslySetInnerHTML={{
                  __html: displayUnitCount(
                    playerInfo,
                    UnitType.PointDefenseArray,
                    samLauncherIcon,
                  ),
                }}
              />
            )}
            {displayUnitCount(
              playerInfo,
              UnitType.Battlecruiser,
              warshipIcon,
            ) && (
              <div
                dangerouslySetInnerHTML={{
                  __html: displayUnitCount(
                    playerInfo,
                    UnitType.Battlecruiser,
                    warshipIcon,
                  ),
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTroopBar = (
    totalPopulation: number,
    attackingPopulation: number,
    maxPopulation: number,
  ) => {
    const base = Math.max(maxPopulation, 1);
    const greenPercentRaw = (totalPopulation / base) * 100;
    const orangePercentRaw = (attackingPopulation / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return (
      <div className="w-full h-5 lg:h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative">
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
          className="absolute inset-0 flex items-center justify-between px-1.5 text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
            {renderPopulation(totalPopulation)}
          </span>
          <span className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
            {renderPopulation(maxPopulation)}
          </span>
        </div>
        <img
          src={soldierIcon}
          alt=""
          aria-hidden="true"
          width="14"
          height="14"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] pointer-events-none"
        />
      </div>
    );
  };

  const renderUnitInfo = (unitInfo: UnitView) => {
    const isAlly =
      unitInfo.owner() === gameView.myPlayer() ||
      gameView.myPlayer()?.isFriendly(unitInfo.owner());

    return (
      <div className="p-2">
        <div
          className={`font-bold mb-1 ${isAlly ? "text-green-500" : "text-white"}`}
        >
          {unitInfo.owner().displayName()}
        </div>
        <div className="mt-1">
          <div className="text-sm opacity-80">{unitInfo.type()}</div>
          {unitInfo.hasHealth() && (
            <div className="text-sm">Health: {unitInfo.health()}</div>
          )}
          {unitInfo.type() === UnitType.AssaultShuttle && (
            <div className="text-sm">
              Population: {renderPopulation(unitInfo.population())}
            </div>
          )}
        </div>
      </div>
    );
  };

  const containerClasses = isInfoVisible
    ? "opacity-100 visible"
    : "opacity-0 invisible pointer-events-none";

  return (
    <div
      className="fixed top-0 left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[1001]"
      style={{ marginTop: `${barOffset}px` }}
      onClick={() => hide()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={`bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg sm:rounded-b-lg shadow-lg text-white text-lg lg:text-base w-full sm:w-[500px] overflow-hidden ${containerClasses}`}
      >
        {player !== null ? renderPlayerInfo(player) : null}
        {unit !== null ? renderUnitInfo(unit) : null}
      </div>
    </div>
  );
}

export default PlayerInfoOverlay;
