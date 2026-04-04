import React, { useEffect, useState, useRef } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { MessageType, PlayerType, UnitType } from "../../core/game/Game";
import {
  AttackUpdate,
  GameUpdateType,
  UnitIncomingUpdate,
} from "../../core/game/GameUpdates";
import { PlayerView, UnitView } from "../../core/game/GameView";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  SendAttackIntentEvent,
} from "../Transport";
import { renderTroops, translateText } from "../Utils";
// TODO(T7): SpriteLoader was removed with the old Canvas renderer.
// getColoredSprite needs a 3D-pipeline replacement in a future ticket.
function getColoredSprite(
  _unit: UnitView,
  _theme: unknown,
): HTMLCanvasElement | null {
  return null;
}
import { useGameTick } from "./useGameTick";
import { useHUDStore } from "../bridge/HUDStore";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "./events";

const soldierIcon = assetUrl("images/SoldierIcon.svg");
const swordIcon = assetUrl("images/SwordIcon.svg");

export function AttacksDisplay(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick(100);
  const [isVisible, setIsVisible] = useState(false);
  const [incomingAttacks, setIncomingAttacks] = useState<AttackUpdate[]>([]);
  const [outgoingAttacks, setOutgoingAttacks] = useState<AttackUpdate[]>([]);
  const [outgoingLandAttacks, setOutgoingLandAttacks] = useState<AttackUpdate[]>(
    [],
  );
  const [outgoingBoats, setOutgoingBoats] = useState<UnitView[]>([]);
  const [incomingBoats, setIncomingBoats] = useState<UnitView[]>([]);
  const incomingBoatIDsRef = useRef(new Set<number>());
  const spriteDataURLCacheRef = useRef(new Map<string, string>());
  const attackRatio = useHUDStore((state) => state.attackRatio);

  // Update on game tick
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

    // Track incoming boat unit IDs from UnitIncoming events
    const updates = gameView.updatesSinceLastTick();
    if (updates) {
      const unitUpdates =
        updates[GameUpdateType.UnitIncoming] as UnitIncomingUpdate[];
      if (unitUpdates) {
        for (const event of unitUpdates) {
          if (
            event.playerID === myPlayer.smallID() &&
            event.messageType === MessageType.NAVAL_INVASION_INBOUND
          ) {
            incomingBoatIDsRef.current.add(event.unitID);
          }
        }
      }
    }

    // Resolve incoming boats from tracked IDs
    const resolvedIncomingBoats: UnitView[] = [];
    for (const unitID of incomingBoatIDsRef.current) {
      const unit = gameView.unit(unitID);
      if (unit && unit.isActive() && unit.type() === UnitType.TransportShip) {
        resolvedIncomingBoats.push(unit);
      } else {
        incomingBoatIDsRef.current.delete(unitID);
      }
    }
    setIncomingBoats(resolvedIncomingBoats);

    const filteredIncoming = myPlayer.incomingAttacks().filter((a) => {
      const t = (gameView.playerBySmallID(a.attackerID) as PlayerView).type();
      return t !== PlayerType.Bot;
    });
    setIncomingAttacks(filteredIncoming);

    const allOutgoing = myPlayer.outgoingAttacks();
    setOutgoingAttacks(allOutgoing.filter((a) => a.targetID !== 0));
    setOutgoingLandAttacks(allOutgoing.filter((a) => a.targetID === 0));

    const boats = myPlayer
      .units()
      .filter((u) => u.type() === UnitType.TransportShip);
    setOutgoingBoats(boats);
  }, [tick, gameView, isVisible]);

  const getBoatSpriteDataURL = (unit: UnitView): string => {
    const owner = unit.owner();
    const key = `boat-${owner.id()}`;
    const cached = spriteDataURLCacheRef.current.get(key);
    if (cached) return cached;
    try {
      const canvas = getColoredSprite(unit, gameView.config().theme());
      if (!canvas) return "";
      const dataURL = canvas.toDataURL();
      spriteDataURLCacheRef.current.set(key, dataURL);
      return dataURL;
    } catch {
      return "";
    }
  };

  const attackWarningOnClick = async (attack: AttackUpdate) => {
    const playerView = gameView.playerBySmallID(attack.attackerID);
    if (playerView !== undefined && playerView instanceof PlayerView) {
      const attacks = await playerView.attackClusteredPositions(attack.id);
      const pos = attacks[0]?.positions[0];

      if (!pos) {
        eventBus.emit(new GoToPlayerEvent(playerView));
      } else {
        eventBus.emit(new GoToPositionEvent(pos.x, pos.y));
      }
    } else {
      const attacker = gameView.playerBySmallID(
        attack.attackerID,
      ) as PlayerView;
      eventBus.emit(new GoToPlayerEvent(attacker));
    }
  };

  const handleRetaliate = (attack: AttackUpdate) => {
    const attacker = gameView.playerBySmallID(
      attack.attackerID,
    ) as PlayerView;
    if (!attacker) return;

    const myPlayer = gameView.myPlayer();
    if (!myPlayer) return;

    const counterTroops = Math.min(
      attack.troops,
      (attackRatio / 100) * myPlayer.troops(),
    );
    eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
  };

  const emitCancelAttackIntent = (id: string) => {
    eventBus.emit(new CancelAttackIntentEvent(id));
  };

  const emitBoatCancelIntent = (id: number) => {
    eventBus.emit(new CancelBoatIntentEvent(id));
  };

  const getBoatTargetName = (boat: UnitView): string => {
    const target = boat.targetTile();
    if (target === undefined) return "";
    const ownerID = gameView.ownerID(target);
    if (ownerID === 0) return "";
    const player = gameView.playerBySmallID(ownerID) as PlayerView;
    return player?.displayName() ?? "";
  };

  const renderButton = (options: {
    content: React.ReactNode;
    onClick?: () => void | Promise<void>;
    className?: string;
    disabled?: boolean;
    hidden?: boolean;
  }) => {
    const {
      content,
      onClick,
      className = "",
      disabled = false,
      hidden = false,
    } = options;

    if (hidden) {
      return null;
    }

    return (
      <button
        className={className}
        onClick={onClick}
        disabled={disabled}
        translate="no"
      >
        {content}
      </button>
    );
  };

  const renderIncomingAttacks = () => {
    if (incomingAttacks.length === 0) return null;

    return incomingAttacks.map((attack) => (
      <div
        key={attack.id}
        className="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
      >
        {renderButton({
          content: (
            <>
              <span className="inline-flex items-center">
                <img
                  src={soldierIcon}
                  className="h-4 w-4"
                  style={{
                    filter:
                      "brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)",
                  }}
                  alt=""
                />
                ↓
              </span>
              <span className="ml-1">{renderTroops(attack.troops)}</span>
              <span className="truncate ml-1">
                {(
                  gameView.playerBySmallID(attack.attackerID) as PlayerView
                )?.displayName()}
              </span>
              {attack.retreating
                ? `(${translateText("events_display.retreating")}...)`
                : ""}
            </>
          ),
          onClick: () => attackWarningOnClick(attack),
          className:
            "text-left text-red-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
        })}
        {!attack.retreating &&
          renderButton({
            content: (
              <img
                src={swordIcon}
                className="h-4 w-4"
                style={{
                  filter:
                    "brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)",
                }}
                alt=""
              />
            ),
            onClick: () => handleRetaliate(attack),
            className:
              "ml-auto inline-flex items-center justify-center cursor-pointer bg-red-900/50 hover:bg-red-800/70 sm:rounded-lg px-1.5 py-1 border border-red-700/50",
          })}
      </div>
    ));
  };

  const renderOutgoingAttacks = () => {
    if (outgoingAttacks.length === 0) return null;

    return outgoingAttacks.map((attack) => (
      <div
        key={attack.id}
        className="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
      >
        {renderButton({
          content: (
            <>
              <span className="inline-flex items-center">
                <img
                  src={soldierIcon}
                  className="h-4 w-4"
                  style={{
                    filter:
                      "brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%)",
                  }}
                  alt=""
                />
                ↑
              </span>
              <span className="ml-1">{renderTroops(attack.troops)}</span>
              <span className="truncate ml-1">
                {(
                  gameView.playerBySmallID(attack.targetID) as PlayerView
                )?.displayName()}
              </span>
            </>
          ),
          onClick: () => attackWarningOnClick(attack),
          className:
            "text-left text-sky-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
        })}
        {!attack.retreating
          ? renderButton({
              content: "❌",
              onClick: () => emitCancelAttackIntent(attack.id),
              className: "ml-auto text-left shrink-0",
              disabled: attack.retreating,
            })
          : renderButton({
              content: (
                <span className="ml-auto truncate text-blue-400">
                  ({translateText("events_display.retreating")}...)
                </span>
              ),
              className: "ml-auto",
            })}
      </div>
    ));
  };

  const renderOutgoingLandAttacks = () => {
    if (outgoingLandAttacks.length === 0) return null;

    return outgoingLandAttacks.map((landAttack) => (
      <div
        key={landAttack.id}
        className="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
      >
        {renderButton({
          content: (
            <>
              <span className="inline-flex items-center">
                <img
                  src={soldierIcon}
                  className="h-4 w-4"
                  style={{
                    filter:
                      "brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%)",
                  }}
                  alt=""
                />
                ↑
              </span>
              <span className="ml-1">{renderTroops(landAttack.troops)}</span>
              {translateText("help_modal.ui_wilderness")}
            </>
          ),
          className:
            "text-left text-sky-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
        })}
        {!landAttack.retreating
          ? renderButton({
              content: "❌",
              onClick: () => emitCancelAttackIntent(landAttack.id),
              className: "ml-auto text-left shrink-0",
              disabled: landAttack.retreating,
            })
          : renderButton({
              content: (
                <span className="ml-auto truncate text-blue-400">
                  ({translateText("events_display.retreating")}...)
                </span>
              ),
              className: "ml-auto",
            })}
      </div>
    ));
  };

  const renderBoats = () => {
    if (outgoingBoats.length === 0) return null;

    return outgoingBoats.map((boat) => {
      const dataURL = getBoatSpriteDataURL(boat);
      return (
        <div
          key={boat.id()}
          className="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
        >
          {renderButton({
            content: (
              <>
                {dataURL && (
                  <img
                    src={dataURL}
                    className="h-5 w-5 inline-block"
                    style={{ imageRendering: "pixelated" }}
                    alt=""
                  />
                )}
                <span className="inline-block min-w-[3rem] text-right">
                  {renderTroops(boat.troops())}
                </span>
                <span className="truncate text-xs ml-1">
                  {getBoatTargetName(boat)}
                </span>
              </>
            ),
            onClick: () => eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-blue-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
          })}
          {!boat.retreating()
            ? renderButton({
                content: "❌",
                onClick: () => emitBoatCancelIntent(boat.id()),
                className: "ml-auto text-left shrink-0",
                disabled: boat.retreating(),
              })
            : renderButton({
                content: (
                  <span className="ml-auto truncate text-blue-400">
                    ({translateText("events_display.retreating")}...)
                  </span>
                ),
                className: "ml-auto",
              })}
        </div>
      );
    });
  };

  const renderIncomingBoats = () => {
    if (incomingBoats.length === 0) return null;

    return incomingBoats.map((boat) => {
      const dataURL = getBoatSpriteDataURL(boat);
      return (
        <div
          key={boat.id()}
          className="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
        >
          {renderButton({
            content: (
              <>
                {dataURL && (
                  <img
                    src={dataURL}
                    className="h-5 w-5 inline-block"
                    style={{ imageRendering: "pixelated" }}
                    alt=""
                  />
                )}
                <span className="inline-block min-w-[3rem] text-right">
                  {renderTroops(boat.troops())}
                </span>
                <span className="truncate text-xs ml-1">
                  {boat.owner()?.displayName()}
                </span>
              </>
            ),
            onClick: () => eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-red-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
          })}
        </div>
      );
    });
  };

  if (!isVisible) {
    return <div />;
  }

  const hasAnything =
    outgoingAttacks.length > 0 ||
    outgoingLandAttacks.length > 0 ||
    outgoingBoats.length > 0 ||
    incomingAttacks.length > 0 ||
    incomingBoats.length > 0;

  if (!hasAnything) {
    return <div />;
  }

  return (
    <div className="w-full mb-1 mt-1 sm:mt-0 pointer-events-auto grid grid-cols-2 gap-1 text-white text-sm lg:text-base max-h-[7rem] overflow-y-auto">
      {renderOutgoingAttacks()}
      {renderOutgoingLandAttacks()}
      {renderBoats()}
      {renderIncomingAttacks()}
      {renderIncomingBoats()}
    </div>
  );
}
