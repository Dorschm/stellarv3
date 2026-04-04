import React, { useRef } from "react";
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
} from "three";
import { useFrame } from "@react-three/fiber";
import { useGameView } from "../bridge/GameViewContext";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { UnitType, Tick } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { UnitView } from "../../core/game/GameView";
import SoundManager, { SoundEffect } from "../sound/SoundManager";

// ─── Constants ──────────────────────���───────────────────────────────────────

/** Height above the map plane for effects. */
const FX_HEIGHT = 3;

// ─── Effect types ──────────────────────────────────────���────────────────────

interface BaseFx {
  elapsed: number;
  duration: number;
  meshes: Mesh[];
}

interface ExplosionFx extends BaseFx {
  kind: "explosion";
  maxRadius: number;
}

interface ShockwaveFx extends BaseFx {
  kind: "shockwave";
  maxRadius: number;
}

interface FlashFx extends BaseFx {
  kind: "flash";
}

interface ConquestFx extends BaseFx {
  kind: "conquest";
}

interface SpawnFx extends BaseFx {
  kind: "spawn";
  maxRadius: number;
}

type ActiveFx = ExplosionFx | ShockwaveFx | FlashFx | ConquestFx | SpawnFx;

// ���── Shared geometry / material pools ───────────────────────────────────────

const _sphereGeo = new SphereGeometry(1, 12, 12);

function createRingGeo(innerRadius: number, outerRadius: number): RingGeometry {
  return new RingGeometry(innerRadius, outerRadius, 32);
}

// ─── Helpers ─���────────────────────────────��─────────────────────────────────

function tileToWorld(
  game: { x: (t: TileRef) => number; y: (t: TileRef) => number; width: () => number; height: () => number },
  tile: TileRef,
): [number, number, number] {
  const halfW = game.width() / 2;
  const halfH = game.height() / 2;
  return [
    game.x(tile) - halfW,
    -(game.y(tile) - halfH),
    FX_HEIGHT,
  ];
}

// ─── Component ───────────────────��──────────────────────────────────────────

/**
 * FxRenderer — 3D visual effects for game events.
 *
 * Handles:
 * - Nuke detonations (expanding sphere + shockwave ring)
 * - Shell impacts (small flash)
 * - Warship destruction (medium explosion)
 * - Structure destruction (flash)
 * - Territory conquest (pulsing highlight)
 * - SAM interceptions (flash + shockwave)
 *
 * Reads game update events from GameView.updatesSinceLastTick() each tick.
 * Sound triggers are preserved — SoundManager calls fire at the same events.
 */
export function FxRenderer(): React.JSX.Element {
  const { gameView: game } = useGameView();

  const groupRef = useRef<Group>(null);
  const fxListRef = useRef<ActiveFx[]>([]);
  const lastProcessedTickRef = useRef<Tick>(-1);
  const spawnedPlayerIdsRef = useRef<Set<string | number>>(new Set());

  // ── Effect factories ────────────────────────────────────────────────

  function spawnExplosion(
    x: number,
    y: number,
    z: number,
    maxRadius: number,
    duration: number,
    color: Color,
  ) {
    if (!groupRef.current) return;

    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new Mesh(_sphereGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(0.1, 0.1, 0.1);
    groupRef.current.add(mesh);

    const fx: ExplosionFx = {
      kind: "explosion",
      elapsed: 0,
      duration,
      maxRadius,
      meshes: [mesh],
    };
    fxListRef.current.push(fx);
  }

  function spawnShockwave(
    x: number,
    y: number,
    z: number,
    maxRadius: number,
    duration: number,
  ) {
    if (!groupRef.current) return;

    const ringGeo = createRingGeo(0.8, 1.0);
    const mat = new MeshBasicMaterial({
      color: new Color(1, 1, 1),
      transparent: true,
      opacity: 0.7,
    });
    const mesh = new Mesh(ringGeo, mat);
    mesh.position.set(x, y, z + 0.5);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(0.1, 0.1, 0.1);
    groupRef.current.add(mesh);

    const fx: ShockwaveFx = {
      kind: "shockwave",
      elapsed: 0,
      duration,
      maxRadius,
      meshes: [mesh],
    };
    fxListRef.current.push(fx);
  }

  function spawnFlash(
    x: number,
    y: number,
    z: number,
    radius: number,
    duration: number,
    color: Color,
  ) {
    if (!groupRef.current) return;

    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new Mesh(_sphereGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, radius, radius);
    groupRef.current.add(mesh);

    const fx: FlashFx = {
      kind: "flash",
      elapsed: 0,
      duration,
      meshes: [mesh],
    };
    fxListRef.current.push(fx);
  }

  function spawnConquestFx(x: number, y: number, z: number) {
    if (!groupRef.current) return;

    const mat = new MeshBasicMaterial({
      color: new Color(1, 0.85, 0),
      transparent: true,
      opacity: 0.7,
    });
    const mesh = new Mesh(_sphereGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(3, 3, 3);
    groupRef.current.add(mesh);

    const fx: ConquestFx = {
      kind: "conquest",
      elapsed: 0,
      duration: 2000,
      meshes: [mesh],
    };
    fxListRef.current.push(fx);
  }

  function spawnSpawnHighlight(x: number, y: number, z: number, color: Color) {
    if (!groupRef.current) return;

    // Expanding ring highlight for spawn
    const ringGeo = createRingGeo(0.5, 1.0);
    const ringMat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
    });
    const ringMesh = new Mesh(ringGeo, ringMat);
    ringMesh.position.set(x, y, z + 0.5);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.scale.set(0.1, 0.1, 0.1);
    groupRef.current.add(ringMesh);

    // Central glow sphere
    const glowMat = new MeshBasicMaterial({
      color: new Color(1, 1, 1),
      transparent: true,
      opacity: 0.6,
    });
    const glowMesh = new Mesh(_sphereGeo, glowMat);
    glowMesh.position.set(x, y, z);
    glowMesh.scale.set(1, 1, 1);
    groupRef.current.add(glowMesh);

    const fx: SpawnFx = {
      kind: "spawn",
      elapsed: 0,
      duration: 2000,
      maxRadius: 30,
      meshes: [ringMesh, glowMesh],
    };
    fxListRef.current.push(fx);
  }

  // ── Event handlers ────────────────────────────────────────────────

  function handleNukeDetonation(unit: UnitView, radius: number) {
    const [x, y, z] = tileToWorld(game, unit.lastTile());
    // Large expanding sphere
    spawnExplosion(x, y, z, radius * 0.5, 1500, new Color(1.0, 0.5, 0.1));
    // Bright core flash
    spawnExplosion(x, y, z, radius * 0.2, 600, new Color(1.0, 1.0, 0.8));
    // Shockwave ring
    spawnShockwave(x, y, z, radius * 1.5, 1500);
  }

  function handleSAMInterception(unit: UnitView) {
    const [x, y, z] = tileToWorld(game, unit.lastTile());
    spawnFlash(x, y, z, 3, 400, new Color(1.0, 0.8, 0.2));
    spawnShockwave(x, y, z, 40, 800);
  }

  function handleShellImpact(unit: UnitView) {
    const [x, y, z] = tileToWorld(game, unit.lastTile());
    spawnFlash(x, y, z, 1.5, 300, new Color(1.0, 0.6, 0.2));
  }

  function handleWarshipDestruction(unit: UnitView) {
    const [x, y, z] = tileToWorld(game, unit.lastTile());
    spawnExplosion(x, y, z, 8, 800, new Color(1.0, 0.4, 0.1));
    spawnFlash(x, y, z, 4, 400, new Color(1.0, 0.8, 0.3));
  }

  function handleStructureDestruction(unit: UnitView) {
    const [x, y, z] = tileToWorld(game, unit.lastTile());
    spawnExplosion(x, y, z, 6, 600, new Color(0.8, 0.4, 0.1));
  }

  function handleTrainDestruction(unit: UnitView) {
    const [x, y, z] = tileToWorld(game, unit.lastTile());
    spawnFlash(x, y, z, 2, 300, new Color(1.0, 0.5, 0.2));
  }

  // ── Per-frame update ────────────────────────────────────────────────
  useFrame((_, delta) => {
    const deltaMs = delta * 1000;
    const currentTick = game.ticks();

    // ── Process game updates (once per tick) ─────────────────────────
    if (currentTick > lastProcessedTickRef.current) {
      lastProcessedTickRef.current = currentTick;

      const updates = game.updatesSinceLastTick();
      if (updates) {
        // Unit events (nukes, shells, warships, structures, trains)
        const unitUpdates = updates[GameUpdateType.Unit];
        if (unitUpdates) {
          for (const update of unitUpdates) {
            if (!update) continue;
            const unitView = game.unit(update.id);
            if (!unitView) continue;
            if (unitView.isActive()) continue; // Only handle death/detonation

            switch (unitView.type()) {
              case UnitType.AtomBomb:
              case UnitType.MIRVWarhead:
                if (unitView.reachedTarget()) {
                  handleNukeDetonation(unitView, 70);
                } else {
                  handleSAMInterception(unitView);
                }
                break;
              case UnitType.HydrogenBomb:
                if (unitView.reachedTarget()) {
                  handleNukeDetonation(unitView, 160);
                } else {
                  handleSAMInterception(unitView);
                }
                break;
              case UnitType.Shell:
                if (unitView.reachedTarget()) {
                  handleShellImpact(unitView);
                }
                break;
              case UnitType.Warship:
                handleWarshipDestruction(unitView);
                break;
              case UnitType.Train:
                if (!unitView.reachedTarget()) {
                  handleTrainDestruction(unitView);
                }
                break;
              case UnitType.DefensePost:
              case UnitType.City:
              case UnitType.Port:
              case UnitType.MissileSilo:
              case UnitType.SAMLauncher:
              case UnitType.Factory:
                handleStructureDestruction(unitView);
                break;
            }
          }
        }

        // Conquest events
        const conquestUpdates = updates[GameUpdateType.ConquestEvent];
        if (conquestUpdates) {
          for (const update of conquestUpdates) {
            if (!update) continue;
            const myPlayer = game.myPlayer();
            if (!myPlayer || update.conquerorId !== myPlayer.id()) continue;

            SoundManager.playSoundEffect(SoundEffect.KaChing);

            const conquered = game.player(update.conqueredId);
            if (conquered) {
              const loc = conquered.nameLocation();
              const halfW = game.width() / 2;
              const halfH = game.height() / 2;
              spawnConquestFx(
                loc.x - halfW,
                -(loc.y - halfH),
                FX_HEIGHT,
              );
            }
          }
        }

        // Spawn highlight events — detect players whose hasSpawned flips to true
        const playerUpdates = updates[GameUpdateType.Player];
        if (playerUpdates) {
          for (const pu of playerUpdates) {
            if (!pu || !pu.hasSpawned) continue;
            if (spawnedPlayerIdsRef.current.has(pu.id)) continue;
            spawnedPlayerIdsRef.current.add(pu.id);

            const player = game.player(pu.id);
            if (!player) continue;
            const loc = player.nameLocation();
            const halfW = game.width() / 2;
            const halfH = game.height() / 2;
            spawnSpawnHighlight(
              loc.x - halfW,
              -(loc.y - halfH),
              FX_HEIGHT,
              new Color(0.2, 0.8, 1.0),
            );
          }
        }
      }
    }

    // ── Animate and clean up active effects ───────────────────────────
    const fxList = fxListRef.current;
    for (let i = fxList.length - 1; i >= 0; i--) {
      const fx = fxList[i];
      fx.elapsed += deltaMs;
      const t = Math.min(1, fx.elapsed / fx.duration);

      if (t >= 1) {
        // Remove completed effect
        for (const mesh of fx.meshes) {
          if (groupRef.current) groupRef.current.remove(mesh);
          mesh.geometry !== _sphereGeo && mesh.geometry.dispose();
          (mesh.material as MeshBasicMaterial).dispose();
        }
        fxList.splice(i, 1);
        continue;
      }

      switch (fx.kind) {
        case "explosion": {
          const scale = fx.maxRadius * easeOutCubic(t);
          for (const mesh of fx.meshes) {
            mesh.scale.set(scale, scale, scale);
            (mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - t);
          }
          break;
        }
        case "shockwave": {
          const scale = fx.maxRadius * easeOutQuad(t);
          for (const mesh of fx.meshes) {
            mesh.scale.set(scale, scale, scale);
            (mesh.material as MeshBasicMaterial).opacity = 0.7 * (1 - t);
          }
          break;
        }
        case "flash": {
          // Quick bright flash that fades out
          const fadeT = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
          for (const mesh of fx.meshes) {
            (mesh.material as MeshBasicMaterial).opacity = 0.8 * Math.max(0, fadeT);
          }
          break;
        }
        case "conquest": {
          // Pulse up then fade
          const pulseScale = 3 + 5 * easeOutCubic(t);
          for (const mesh of fx.meshes) {
            mesh.scale.set(pulseScale, pulseScale, pulseScale);
            (mesh.material as MeshBasicMaterial).opacity = 0.7 * (1 - easeInQuad(t));
          }
          break;
        }
        case "spawn": {
          // Expanding ring + fading central glow
          const ringScale = fx.maxRadius * easeOutCubic(t);
          const ringMesh = fx.meshes[0];
          if (ringMesh) {
            ringMesh.scale.set(ringScale, ringScale, ringScale);
            (ringMesh.material as MeshBasicMaterial).opacity = 0.8 * (1 - t);
          }
          const glowMesh = fx.meshes[1];
          if (glowMesh) {
            const glowScale = 2 + 4 * easeOutCubic(t);
            glowMesh.scale.set(glowScale, glowScale, glowScale);
            (glowMesh.material as MeshBasicMaterial).opacity = 0.6 * (1 - easeInQuad(t));
          }
          break;
        }
      }
    }
  });

  return <group ref={groupRef} />;
}

// ─── Easing functions ────────��──────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInQuad(t: number): number {
  return t * t;
}
