import React, { useEffect, useState } from "react";
import { PlayerType } from "../../core/game/Game";
import {
  BrokeAllianceUpdate,
  GameUpdateType,
} from "../../core/game/GameUpdates";
import { UserSettings } from "../../core/game/UserSettings";
import { useGameTick } from "./useGameTick";

const ALERT_SPEED = 1.6;
const ALERT_COUNT = 2;
const RETALIATION_WINDOW_TICKS = 15 * 10; // 15 seconds
const ALERT_COOLDOWN_TICKS = 15 * 10; // 15 seconds

export function AlertFrame(): React.JSX.Element {
  const { gameView, tick } = useGameTick();
  const [isActive, setIsActive] = useState(false);
  const [alertType, setAlertType] = useState<"betrayal" | "local-attack">(
    "betrayal",
  );
  const userSettings = new UserSettings();

  const seenAttackIdsRef = React.useRef<Set<string>>(new Set());
  const lastAlertTickRef = React.useRef(-1);
  const outgoingAttackTicksRef = React.useRef<Map<number, number>>(new Map());

  const activateAlert = () => {
    if (userSettings.alertFrame()) {
      setIsActive(true);
      lastAlertTickRef.current = gameView.ticks();
    }
  };

  const trackOutgoingAttacks = () => {
    const myPlayer = gameView.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      return;
    }

    const currentTick = gameView.ticks();
    const outgoingAttacks = myPlayer.outgoingAttacks();

    // Track when we attack other players (not terra nullius)
    for (const attack of outgoingAttacks) {
      // Only track attacks on players (targetID !== 0 means it's a player, not unclaimed territory)
      if (attack.targetID !== 0 && !attack.retreating) {
        const existingTick = outgoingAttackTicksRef.current.get(
          attack.targetID,
        );

        // Only update timestamp if:
        // 1. This is a new attack (not in map yet), OR
        // 2. The existing entry has expired (older than retaliation window)
        if (
          existingTick === undefined ||
          currentTick - existingTick >= RETALIATION_WINDOW_TICKS
        ) {
          outgoingAttackTicksRef.current.set(attack.targetID, currentTick);
        }
      }
    }

    // Clean up old entries (older than retaliation window)
    for (const [
      playerID,
      tickTime,
    ] of outgoingAttackTicksRef.current.entries()) {
      if (currentTick - tickTime > RETALIATION_WINDOW_TICKS) {
        outgoingAttackTicksRef.current.delete(playerID);
      }
    }
  };

  const checkForNewAttacks = () => {
    const myPlayer = gameView.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      return;
    }

    const incomingAttacks = myPlayer.incomingAttacks();
    const currentTick = gameView.ticks();

    // Check if we're in cooldown (within 10 seconds of last alert)
    const inCooldown =
      lastAlertTickRef.current !== -1 &&
      currentTick - lastAlertTickRef.current < ALERT_COOLDOWN_TICKS;

    // Find new attacks that we haven't seen yet
    const playerPopulation = myPlayer.population();
    const minAttackPopulationThreshold = playerPopulation / 5; // 1/5 of current population

    for (const attack of incomingAttacks) {
      // Only alert for non-retreating attacks
      if (!attack.retreating && !seenAttackIdsRef.current.has(attack.id)) {
        const attacker = gameView.playerBySmallID(attack.attackerID);
        if (!attacker.isPlayer()) {
          seenAttackIdsRef.current.add(attack.id);
          continue;
        }
        if (attacker.type() === PlayerType.Bot) {
          seenAttackIdsRef.current.add(attack.id);
          continue;
        }

        // Check if this is a retaliation (we attacked them recently)
        const ourAttackTick = outgoingAttackTicksRef.current.get(
          attack.attackerID,
        );
        const isRetaliation =
          ourAttackTick !== undefined &&
          currentTick - ourAttackTick < RETALIATION_WINDOW_TICKS;

        // Check if attack is too small (less than 1/5 of our population)
        const isSmallAttack = attack.population < minAttackPopulationThreshold;

        // Don't alert if:
        // 1. We're in cooldown from a recent alert
        // 2. This is a retaliation (we attacked them within 15 seconds)
        // 3. The attack is too small (less than 1/5 of our population)
        if (!inCooldown && !isRetaliation && !isSmallAttack) {
          seenAttackIdsRef.current.add(attack.id);
          setAlertType("local-attack");
          activateAlert();
        } else {
          // Still mark as seen so we don't alert later
          seenAttackIdsRef.current.add(attack.id);
        }
      }
    }

    // Clean up IDs for attacks that are no longer active (retreating or completed)
    const activeAttackIds = new Set(incomingAttacks.map((a) => a.id));

    // Remove IDs for attacks that are no longer in the incoming attacks list
    for (const attackId of seenAttackIdsRef.current) {
      if (!activeAttackIds.has(attackId)) {
        seenAttackIdsRef.current.delete(attackId);
      }
    }
  };

  useEffect(() => {
    const myPlayer = gameView.myPlayer();

    // Clear tracked attacks if player dies or doesn't exist
    if (!myPlayer || !myPlayer.isAlive()) {
      seenAttackIdsRef.current.clear();
      outgoingAttackTicksRef.current.clear();
      lastAlertTickRef.current = -1;
      return;
    }

    // Track outgoing attacks to detect retaliation
    trackOutgoingAttacks();

    // Check for BrokeAllianceUpdate events
    const updates = gameView.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.BrokeAlliance]) {
      updates[GameUpdateType.BrokeAlliance].forEach((update) => {
        const brokeAlliance = update as BrokeAllianceUpdate;
        const betrayed = gameView.playerBySmallID(brokeAlliance.betrayedID);

        // Only trigger alert if the current player is the betrayed one
        if (betrayed === myPlayer) {
          setAlertType("betrayal");
          activateAlert();
        }
      });
    }

    // Check for new incoming attacks
    checkForNewAttacks();
  }, [tick, gameView]);

  const dismissAlert = () => {
    setIsActive(false);
  };

  if (!isActive) {
    return <></>;
  }

  return (
    <div
      className={`alert-border animate ${alertType}`}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        border: "17px solid",
        boxSizing: "border-box",
        zIndex: 40,
        opacity: 0,
        borderColor: alertType === "betrayal" ? "#ee0000" : "#ffa500",
        animation: `alertBlink ${ALERT_SPEED}s ease-in-out ${ALERT_COUNT}`,
      }}
      onAnimationEnd={dismissAlert}
    >
      <style>{`
        @keyframes alertBlink {
          0% {
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

export default AlertFrame;
