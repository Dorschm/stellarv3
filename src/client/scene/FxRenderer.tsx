import { useFrame } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef } from "react";
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RingGeometry,
  SphereGeometry,
} from "three";
import { GameUpdates, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { UnitView } from "../../core/game/GameView";
import { useGameView } from "../bridge/GameViewContext";
import { SceneTickEvent } from "../InputHandler";
import SoundManager, { SoundEffect } from "../sound/SoundManager";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Height above the map plane for effects. */
const FX_HEIGHT = 3;

// ─── Effect types ──────────────────────────────────────────────────────────

interface BaseFx {
  elapsed: number;
  duration: number;
  meshes: Mesh[];
  /** Geometries that this Fx owns (must be disposed). Excludes shared pools. */
  ownedGeometries: RingGeometry[];
  /** Optional point light for FX readability (disposed with the effect). */
  light?: PointLight;
  /** Peak intensity for the light (scaled down over lifetime). */
  lightPeakIntensity?: number;
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

// ─── Shared geometry / material pools ───────────────────────────────────────

/**
 * Shared sphere geometry — used by many short-lived Fx meshes. This is
 * owned at module scope and disposed once on component unmount via
 * {@link disposeSharedGeometries}. Individual Fx meshes must NOT dispose it.
 */
const _sphereGeo = new SphereGeometry(1, 12, 12);
let _sphereGeoRefCount = 0;

function acquireSharedGeometries() {
  _sphereGeoRefCount++;
}

function releaseSharedGeometries() {
  _sphereGeoRefCount--;
  if (_sphereGeoRefCount <= 0) {
    _sphereGeoRefCount = 0;
    // NOTE: we intentionally do NOT dispose the module-level _sphereGeo —
    // React StrictMode / fast-refresh can unmount/remount and the geometry
    // needs to survive for the next instance. If truly necessary the host
    // can re-import a fresh module. This refcount just prevents double-free.
  }
}

function createRingGeo(innerRadius: number, outerRadius: number): RingGeometry {
  return new RingGeometry(innerRadius, outerRadius, 32);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tileToWorld(
  game: {
    x: (t: TileRef) => number;
    y: (t: TileRef) => number;
    width: () => number;
    height: () => number;
  },
  tile: TileRef,
): [number, number, number] {
  const halfW = game.width() / 2;
  const halfH = game.height() / 2;
  return [game.x(tile) - halfW, -(game.y(tile) - halfH), FX_HEIGHT];
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * FxRenderer — 3D visual effects for game events.
 *
 * Handles:
 * - Nuke detonations (expanding sphere + shockwave ring + point-light flash)
 * - Shell impacts (small flash)
 * - Battlecruiser destruction (medium explosion)
 * - Structure destruction (flash)
 * - Territory conquest (pulsing highlight)
 * - SAM interceptions (flash + shockwave)
 *
 * Ingests game update events via {@link SceneTickEvent} emitted once per
 * game tick by {@link ClientGameRunner}. This guarantees every tick is
 * processed exactly once — polling `GameView.updatesSinceLastTick()` from
 * `useFrame` would drop ticks during catch-up / reconnects, causing missing
 * explosions and sound cues.
 *
 * Sound triggers are preserved — SoundManager calls fire at the same events.
 */
export function FxRenderer(): React.JSX.Element {
  const { gameView: game, eventBus } = useGameView();

  const groupRef = useRef<Group>(null);
  const fxListRef = useRef<ActiveFx[]>([]);
  const spawnedPlayerIdsRef = useRef<Set<string | number>>(new Set());

  // ── Effect factories ────────────────────────────────────────────────

  const spawnExplosion = useCallback(
    (
      x: number,
      y: number,
      z: number,
      maxRadius: number,
      duration: number,
      color: Color,
      withLight: boolean = false,
    ) => {
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

      let light: PointLight | undefined;
      let lightPeakIntensity: number | undefined;
      if (withLight) {
        lightPeakIntensity = Math.max(4, maxRadius * 0.3);
        light = new PointLight(color, lightPeakIntensity, maxRadius * 6, 2);
        light.position.set(x, y, z + 2);
        groupRef.current.add(light);
      }

      const fx: ExplosionFx = {
        kind: "explosion",
        elapsed: 0,
        duration,
        maxRadius,
        meshes: [mesh],
        ownedGeometries: [],
        light,
        lightPeakIntensity,
      };
      fxListRef.current.push(fx);
    },
    [],
  );

  const spawnShockwave = useCallback(
    (x: number, y: number, z: number, maxRadius: number, duration: number) => {
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
        ownedGeometries: [ringGeo],
      };
      fxListRef.current.push(fx);
    },
    [],
  );

  const spawnFlash = useCallback(
    (
      x: number,
      y: number,
      z: number,
      radius: number,
      duration: number,
      color: Color,
    ) => {
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
        ownedGeometries: [],
      };
      fxListRef.current.push(fx);
    },
    [],
  );

  const spawnConquestFx = useCallback((x: number, y: number, z: number) => {
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
      ownedGeometries: [],
    };
    fxListRef.current.push(fx);
  }, []);

  const spawnSpawnHighlight = useCallback(
    (x: number, y: number, z: number, color: Color) => {
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
        ownedGeometries: [ringGeo],
      };
      fxListRef.current.push(fx);
    },
    [],
  );

  // ── Event handlers ────────────────────────────────────────────────

  const handleNukeDetonation = useCallback(
    (unit: UnitView, radius: number) => {
      const [x, y, z] = tileToWorld(game, unit.lastTile());
      // Large expanding sphere — with a dedicated point light for readability
      spawnExplosion(
        x,
        y,
        z,
        radius * 0.5,
        1500,
        new Color(1.0, 0.5, 0.1),
        true,
      );
      // Bright core flash
      spawnExplosion(x, y, z, radius * 0.2, 600, new Color(1.0, 1.0, 0.8));
      // Shockwave ring
      spawnShockwave(x, y, z, radius * 1.5, 1500);
    },
    [game, spawnExplosion, spawnShockwave],
  );

  const handleSAMInterception = useCallback(
    (unit: UnitView) => {
      const [x, y, z] = tileToWorld(game, unit.lastTile());
      spawnFlash(x, y, z, 3, 400, new Color(1.0, 0.8, 0.2));
      spawnShockwave(x, y, z, 40, 800);
    },
    [game, spawnFlash, spawnShockwave],
  );

  const handleShellImpact = useCallback(
    (unit: UnitView) => {
      const [x, y, z] = tileToWorld(game, unit.lastTile());
      spawnFlash(x, y, z, 1.5, 300, new Color(1.0, 0.6, 0.2));
    },
    [game, spawnFlash],
  );

  const handleWarshipDestruction = useCallback(
    (unit: UnitView) => {
      const [x, y, z] = tileToWorld(game, unit.lastTile());
      spawnExplosion(x, y, z, 8, 800, new Color(1.0, 0.4, 0.1), true);
      spawnFlash(x, y, z, 4, 400, new Color(1.0, 0.8, 0.3));
    },
    [game, spawnExplosion, spawnFlash],
  );

  const handleStructureDestruction = useCallback(
    (unit: UnitView) => {
      const [x, y, z] = tileToWorld(game, unit.lastTile());
      spawnExplosion(x, y, z, 6, 600, new Color(0.8, 0.4, 0.1), true);
    },
    [game, spawnExplosion],
  );

  const handleTrainDestruction = useCallback(
    (unit: UnitView) => {
      const [x, y, z] = tileToWorld(game, unit.lastTile());
      spawnFlash(x, y, z, 2, 300, new Color(1.0, 0.5, 0.2));
    },
    [game, spawnFlash],
  );

  // ── Process a single tick's updates ────────────────────────────────
  const processTickUpdates = useCallback(
    (updates: GameUpdates) => {
      // Unit events (nukes, shells, warships, structures, trains)
      const unitUpdates = updates[GameUpdateType.Unit];
      if (unitUpdates) {
        for (const update of unitUpdates) {
          if (!update) continue;
          const unitView = game.unit(update.id);
          if (!unitView) continue;
          if (unitView.isActive()) continue; // Only handle death/detonation

          switch (unitView.type()) {
            case UnitType.AntimatterTorpedo:
            case UnitType.ClusterWarheadSubmunition:
              if (unitView.reachedTarget()) {
                handleNukeDetonation(unitView, 70);
              } else {
                handleSAMInterception(unitView);
              }
              break;
            case UnitType.NovaBomb:
              if (unitView.reachedTarget()) {
                handleNukeDetonation(unitView, 160);
              } else {
                handleSAMInterception(unitView);
              }
              break;
            case UnitType.PlasmaBolt:
              if (unitView.reachedTarget()) {
                handleShellImpact(unitView);
              }
              break;
            case UnitType.Battlecruiser:
              handleWarshipDestruction(unitView);
              break;
            case UnitType.Frigate:
              if (!unitView.reachedTarget()) {
                handleTrainDestruction(unitView);
              }
              break;
            case UnitType.DefenseStation:
            case UnitType.Colony:
            case UnitType.Spaceport:
            case UnitType.OrbitalStrikePlatform:
            case UnitType.PointDefenseArray:
            case UnitType.Foundry:
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
            spawnConquestFx(loc.x - halfW, -(loc.y - halfH), FX_HEIGHT);
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
    },
    [
      game,
      handleNukeDetonation,
      handleSAMInterception,
      handleShellImpact,
      handleWarshipDestruction,
      handleTrainDestruction,
      handleStructureDestruction,
      spawnConquestFx,
      spawnSpawnHighlight,
    ],
  );

  // ── Helper to tear down a single fx (used on completion and unmount)
  const disposeFx = useCallback((fx: ActiveFx) => {
    for (const mesh of fx.meshes) {
      if (groupRef.current) groupRef.current.remove(mesh);
      // Dispose per-instance geometries only. The shared _sphereGeo is
      // module-owned and must NOT be disposed here — doing so would break
      // subsequent effects that reference the same buffer.
      (mesh.material as MeshBasicMaterial).dispose();
    }
    for (const geo of fx.ownedGeometries) {
      geo.dispose();
    }
    if (fx.light) {
      if (groupRef.current) groupRef.current.remove(fx.light);
      fx.light.dispose();
    }
  }, []);

  // ── Tick-driven ingestion via EventBus ──────────────────────────────
  useEffect(() => {
    acquireSharedGeometries();

    const handler = (event: SceneTickEvent) => {
      processTickUpdates(event.updates);
    };
    eventBus.on(SceneTickEvent, handler);

    return () => {
      eventBus.off(SceneTickEvent, handler);
      // Dispose every in-flight effect's owned resources on unmount so
      // repeated session transitions do not leak GPU memory.
      for (const fx of fxListRef.current) {
        disposeFx(fx);
      }
      fxListRef.current = [];
      releaseSharedGeometries();
    };
  }, [eventBus, processTickUpdates, disposeFx]);

  // ── Per-frame animation only (NO update polling) ───────────────────
  useFrame((_, delta) => {
    const deltaMs = delta * 1000;

    // ── Animate and clean up active effects ───────────────────────────
    const fxList = fxListRef.current;
    for (let i = fxList.length - 1; i >= 0; i--) {
      const fx = fxList[i];
      fx.elapsed += deltaMs;
      const t = Math.min(1, fx.elapsed / fx.duration);

      if (t >= 1) {
        disposeFx(fx);
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
          if (fx.light && fx.lightPeakIntensity !== undefined) {
            // Bright at t=0, decays to zero by t=1.
            fx.light.intensity = fx.lightPeakIntensity * (1 - t) * (1 - t);
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
            (mesh.material as MeshBasicMaterial).opacity =
              0.8 * Math.max(0, fadeT);
          }
          break;
        }
        case "conquest": {
          // Pulse up then fade
          const pulseScale = 3 + 5 * easeOutCubic(t);
          for (const mesh of fx.meshes) {
            mesh.scale.set(pulseScale, pulseScale, pulseScale);
            (mesh.material as MeshBasicMaterial).opacity =
              0.7 * (1 - easeInQuad(t));
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
            (glowMesh.material as MeshBasicMaterial).opacity =
              0.6 * (1 - easeInQuad(t));
          }
          break;
        }
      }
    }
  });

  return <group ref={groupRef} />;
}

// ─── Easing functions ──────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInQuad(t: number): number {
  return t * t;
}
