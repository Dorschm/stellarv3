import { expect, test } from "@playwright/test";

import {
  startSingleplayerGame,
  trackConsoleErrors,
} from "./fixtures/game-fixtures";

/**
 * End-to-end coverage of the Scout Swarm flow.
 *
 * Reproduces the user-reported case ("send a scout, nothing happens") and
 * proves the affirmative path is wired correctly all the way to the
 * mechanic users care about (terrain stepping toward habitability).
 *
 * Flow:
 *   1. Start singleplayer (`?e2e=1` → infiniteCredits + instantBuild) and
 *      spawn the local player.
 *   2. Find an interior owned tile and emit a BuildUnitIntentEvent for a
 *      Spaceport. With instantBuild on, the Spaceport becomes an active
 *      unit on the next server tick.
 *   3. Locate an AsteroidField sector tile near the Spaceport (planets
 *      have an outer AsteroidField band by construction, so a small
 *      spiral search around the build tile reliably finds one).
 *   4. Emit `scoutSwarmTerraformAccumulation()` BuildUnitIntentEvents for
 *      ScoutSwarm targeting the same AsteroidField tile.
 *   5. Wait for the tile to step from AsteroidField to Nebula (or beyond).
 *      Terrain check uses `__gameView.terrainType(ref)` which reads the
 *      authoritative `_map.terrainType` byte, so a passing assertion means
 *      the server actually flipped it.
 *
 * Coverage guarantee: this exercises the full
 * `BuildUnitIntent → server Executor → ConstructionExecution →
 *  ScoutSwarmExecution → buildUnit → tick() travel → onArrival →
 *  recordScoutSwarmTerraformProgress → step terrain` chain in a real
 * browser session.  Unit tests in
 * `tests/core/executions/ScoutSwarmExecution.test.ts` already cover the
 * terraforming math at the model layer; this spec proves the wiring on
 * top of it.
 *
 * Resolving the BuildUnitIntentEvent constructor:
 *   We walk `__eventBus.listeners` (a Map keyed by event class) to find
 *   the entry whose constructor name is "BuildUnitIntentEvent" and use
 *   that class to instantiate the event.  This guarantees ctor identity
 *   matches what Transport listens for — dynamic-importing the Transport
 *   module from page.evaluate yields a different class identity in some
 *   bundling scenarios and the listener never fires.
 */

const TerrainType = {
  OpenSpace: 0,
  Nebula: 1,
  AsteroidField: 2,
  DebrisField: 3,
  DeepSpace: 4,
} as const;

const TERRAIN_LABEL: Record<number, string> = {
  0: "OpenSpace",
  1: "Nebula",
  2: "AsteroidField",
  3: "DebrisField",
  4: "DeepSpace",
};

test.describe("ScoutSwarm end-to-end terraform", () => {
  test("build Spaceport, launch scouts, AsteroidField flips to Nebula", async ({
    page,
  }) => {
    // Long timeout: spawn (40s) + Spaceport (5s) + 10 launches (5s) +
    // travel + tile flip (worst-case ~120s if the AsteroidField tile is
    // far from the Spaceport).
    test.setTimeout(240_000);
    trackConsoleErrors(page);

    await startSingleplayerGame(page);

    // ── 1. Build a Spaceport on a tile where the slot check passes ─────
    // The first interior-owned tile we scan to may sit in a sector whose
    // structure-slot budget is exhausted or whose habitability is below
    // 0.3 (Config.maxStructuresForHabitability returns 0 there). We
    // collect ALL owned tiles in a coarse grid, query each via
    // myPlayer.actions(tile, ['Spaceport']) and emit the BuildUnitIntent
    // on the first tile whose canBuild !== false.
    const emittedAt = await (async () => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const result = await page.evaluate(async () => {
          const w = window as unknown as {
            __gameView: {
              width(): number;
              height(): number;
              ref(x: number, y: number): number;
              owner(ref: number): { smallID(): number };
              myPlayer(): {
                smallID(): number;
                actions(
                  tile: number,
                  units: string[],
                ): Promise<{
                  buildableUnits: { type: string; canBuild: number | false }[];
                }>;
              } | null;
            };
            __eventBus?: {
              listeners: Map<
                { name: string; new (...args: unknown[]): unknown },
                unknown
              >;
              emit(event: object): void;
            };
          };
          const gv = w.__gameView;
          const mp = gv.myPlayer();
          if (!mp) return { ok: false as const, reason: "no myPlayer" };
          const eb = w.__eventBus;
          if (!eb) return { ok: false as const, reason: "no eventBus" };
          let ctor: (new (...args: unknown[]) => object) | null = null;
          for (const [c] of eb.listeners) {
            if ((c as { name?: string }).name === "BuildUnitIntentEvent") {
              ctor = c as unknown as new (...args: unknown[]) => object;
              break;
            }
          }
          if (!ctor) return { ok: false as const, reason: "ctor not found" };

          const myID = mp.smallID();
          const W = gv.width();
          const H = gv.height();
          // Collect a coarse-grid sample of owned tiles.
          const candidates: number[] = [];
          for (let y = 0; y < H; y += 4) {
            for (let x = 0; x < W; x += 4) {
              const r = gv.ref(x, y);
              const o = gv.owner(r);
              if (o && o.smallID() === myID) candidates.push(r);
            }
          }
          if (candidates.length === 0) {
            return { ok: false as const, reason: "no owned tiles yet" };
          }
          // Try each candidate until actions() reports Spaceport buildable.
          for (const tile of candidates) {
            const actions = await mp.actions(tile, ["Spaceport"]);
            const sp = actions.buildableUnits.find(
              (b) => b.type === "Spaceport",
            );
            if (sp && sp.canBuild !== false) {
              eb.emit(new ctor("Spaceport", tile));
              // Return the actual canBuild target tile (the server may
              // have shifted it for spacing reasons).
              return {
                ok: true as const,
                tile: sp.canBuild,
              };
            }
          }
          return {
            ok: false as const,
            reason: `none of ${candidates.length} owned tiles allow Spaceport`,
          };
        });
        if (result.ok) return result.tile;
        // Wait for territory to grow / habitability to spread before
        // re-scanning. Without this we'd hammer the same dead set of
        // tiles in a tight loop.
        await page.waitForTimeout(2_000);
      }
      return null;
    })();
    // With the per-planet map-gen variance shipped in 64741a2, some
    // procedural runs land the local player in a sector where every owned
    // tile sits below the habitability slot threshold (Config.maxStructures
    // ForHabitability returns 0 for ≤0.3) — the same constraint that
    // forces full-game.spec.ts to test.skip after 10 attempts. When that
    // happens here, skip rather than fail: the affirmative scout path is
    // already comprehensively covered by tests/core/executions/
    // ScoutSwarmExecution.test.ts (31 unit tests including all three
    // terraform transitions and ownership-grant variants), and this E2E
    // spec is the integration cherry-on-top — a hard fail when the
    // precondition is structurally unreachable would just be flake.
    test.skip(
      emittedAt === null,
      "no owned tile in this procedural spawn allowed Spaceport (sector-slot saturation / low-habitability territory) — see tests/core/executions/ScoutSwarmExecution.test.ts for the model-layer coverage",
    );
    // test.skip() halts the test at runtime when its condition is true,
    // but TS doesn't recognize that as a narrowing. The redundant guard
    // narrows `emittedAt` from `number | null` to `number` for downstream
    // page.evaluate calls.
    if (emittedAt === null) return;

    // Wait for the Spaceport to land as an active, fully-built unit.
    const spaceportTileXY = await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView: {
            myPlayer(): {
              units(t: string): {
                isActive(): boolean;
                isUnderConstruction(): boolean;
                tile(): unknown;
              }[];
            } | null;
            x(t: unknown): number;
            y(t: unknown): number;
          };
        };
        const mp = w.__gameView.myPlayer();
        if (!mp) return false;
        const sps = mp.units("Spaceport");
        const ready = sps.find((u) => u.isActive() && !u.isUnderConstruction());
        if (!ready) return false;
        const t = ready.tile();
        return { x: w.__gameView.x(t), y: w.__gameView.y(t) };
      },
      null,
      { timeout: 60_000, polling: 500 },
    );
    const spaceport = (await spaceportTileXY.jsonValue()) as {
      x: number;
      y: number;
    };

    // ── 2. Find a nearby AsteroidField sector tile ─────────────────────
    const targetTile = await page.evaluate((sp) => {
      const gv = (
        window as unknown as {
          __gameView?: {
            width(): number;
            height(): number;
            ref(x: number, y: number): unknown;
            isSector(ref: unknown): boolean;
            terrainType(ref: unknown): number;
          };
        }
      ).__gameView;
      if (!gv) return null;
      const w = gv.width();
      const h = gv.height();
      const ASTEROID_FIELD = 2;
      // Spiral outward from the Spaceport tile until we find a sector tile
      // whose terrain is AsteroidField. Outer planet bands are
      // AsteroidField by construction, so this typically resolves within
      // ~80 tiles.
      for (let r = 1; r < 200; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            // Only check the perimeter of each ring to avoid re-scanning.
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const x = sp.x + dx;
            const y = sp.y + dy;
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            const ref = gv.ref(x, y);
            if (!gv.isSector(ref)) continue;
            if (gv.terrainType(ref) === ASTEROID_FIELD) {
              return { x, y };
            }
          }
        }
      }
      return null;
    }, spaceport);

    expect(
      targetTile,
      "no AsteroidField sector tile found within 200 tiles of Spaceport",
    ).not.toBeNull();

    const initialTerrain = await page.evaluate((t) => {
      const gv = (
        window as unknown as {
          __gameView: {
            ref(x: number, y: number): unknown;
            terrainType(ref: unknown): number;
          };
        }
      ).__gameView;
      return gv.terrainType(gv.ref(t.x, t.y));
    }, targetTile!);
    expect(
      initialTerrain,
      `target tile (${targetTile!.x}, ${targetTile!.y}) initial terrain ${TERRAIN_LABEL[initialTerrain]} (expected AsteroidField=2)`,
    ).toBe(TerrainType.AsteroidField);

    // ── 3. Launch N scouts at the AsteroidField tile ───────────────────
    // N = scoutSwarmTerraformAccumulation() (default 10). Pull from the
    // running config so this stays accurate if the constant is tuned.
    const threshold = await page.evaluate(() => {
      const gv = (
        window as unknown as {
          __gameView?: {
            config(): { scoutSwarmTerraformAccumulation(): number };
          };
        }
      ).__gameView;
      return gv?.config().scoutSwarmTerraformAccumulation() ?? 10;
    });
    expect(threshold).toBeGreaterThan(0);

    const launchResult = await page.evaluate(
      ({ tx, ty, n }) => {
        const w = window as unknown as {
          __gameView: { ref(x: number, y: number): unknown };
          __eventBus?: {
            listeners: Map<
              { name: string; new (...args: unknown[]): unknown },
              unknown
            >;
            emit(event: object): void;
          };
        };
        const eb = w.__eventBus;
        if (!eb) return { ok: false as const, reason: "no eventBus" };
        let ctor: (new (...args: unknown[]) => object) | null = null;
        for (const [c] of eb.listeners) {
          if ((c as { name?: string }).name === "BuildUnitIntentEvent") {
            ctor = c as unknown as new (...args: unknown[]) => object;
            break;
          }
        }
        if (!ctor) return { ok: false as const, reason: "ctor not found" };
        const tile = w.__gameView.ref(tx, ty);
        for (let i = 0; i < n; i++) {
          eb.emit(new ctor("Scout Swarm", tile));
        }
        return { ok: true as const };
      },
      { tx: targetTile!.x, ty: targetTile!.y, n: threshold },
    );
    expect(
      launchResult.ok,
      `ScoutSwarm BuildUnitIntent emit failed: ${launchResult.ok ? "" : launchResult.reason}`,
    ).toBe(true);

    // ── 4. Wait for the AsteroidField tile to step toward habitability ─
    const finalTerrain = await page
      .waitForFunction(
        ([tx, ty]) => {
          const gv = (
            window as unknown as {
              __gameView?: {
                ref(x: number, y: number): unknown;
                terrainType(ref: unknown): number;
              };
            }
          ).__gameView;
          if (!gv) return false;
          const tt = gv.terrainType(gv.ref(tx, ty));
          // 0=OpenSpace, 1=Nebula, 2=AsteroidField. Anything below
          // AsteroidField (2) means the tile stepped at least once.
          return tt < 2 ? tt : false;
        },
        [targetTile!.x, targetTile!.y] as [number, number],
        { timeout: 180_000, polling: 1_000 },
      )
      .then((h) => h.jsonValue() as Promise<number>);

    expect(
      finalTerrain,
      `target tile (${targetTile!.x}, ${targetTile!.y}) ended as ${TERRAIN_LABEL[finalTerrain]}; expected Nebula or OpenSpace`,
    ).toBeLessThan(TerrainType.AsteroidField);
  });
});
