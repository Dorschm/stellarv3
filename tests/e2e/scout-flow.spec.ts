import { expect, test } from "@playwright/test";

import { trackConsoleErrors, waitForInGame } from "./fixtures/game-fixtures";

/**
 * End-to-end coverage of the Scout Swarm flow.
 *
 * Reproduces the user-reported case ("send a scout, nothing happens") and
 * proves the affirmative path is wired correctly all the way to the
 * mechanic users care about (terrain stepping toward habitability).
 *
 * Why this spec doesn't use the shared `startSingleplayerGame` fixture:
 *   The shared fixture's `spawnLocalPlayer` picks the first unowned
 *   sector tile in the chosen quadrant, which on procedural Sol System
 *   often lands the local player in the AsteroidField outer ring of a
 *   planet. Those tiles have habitability < 0.3, so
 *   `Config.maxStructuresForHabitability()` returns 0 and the sector
 *   refuses every Spaceport build (silent canBuild=false). We instead
 *   scan for an OpenSpace inner-ring tile with no current owner — those
 *   carry full habitability so the slot budget is non-zero and the
 *   Spaceport build succeeds deterministically.
 *
 * Resolving the BuildUnitIntentEvent constructor:
 *   We walk `__eventBus.listeners` (a Map keyed by event class) to find
 *   the entry whose constructor name is "BuildUnitIntentEvent" and use
 *   that class to instantiate the event.  This guarantees ctor identity
 *   matches what Transport listens for — dynamic-importing the Transport
 *   module from page.evaluate yields a different class identity in some
 *   bundling scenarios and the listener never fires.
 *
 * Coverage guarantee: this exercises the full
 * `BuildUnitIntent → server Executor → ConstructionExecution →
 *  ScoutSwarmExecution → buildUnit → tick() travel → onArrival →
 *  recordScoutSwarmTerraformProgress → step terrain` chain in a real
 * browser session.  Unit tests in
 * `tests/core/executions/ScoutSwarmExecution.test.ts` already cover the
 * terraforming math at the model layer; this spec proves the wiring on
 * top of it AND captures visual artifacts (screenshots) at the key
 * moments (before launch / mid-flight / after flip).
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
    test.setTimeout(240_000);
    trackConsoleErrors(page);

    // ── 0. Manual game start so we can spawn at a known good tile ──────
    await page.goto("/?e2e=1");
    const soloButton = page
      .getByRole("button", { name: /^(solo|single player)$/i })
      .first();
    await expect(soloButton).toBeVisible({ timeout: 40_000 });
    await soloButton.click();
    const startButton = page
      .getByRole("button", { name: /^start game$/i })
      .first();
    await expect(startButton).toBeVisible({ timeout: 10_000 });
    await startButton.click();
    await waitForInGame(page);

    // ── 1. Spawn at the highest-habitability unowned tile we can find ──
    // Selection criteria:
    //   - terrainType === OpenSpace (innermost band of every planet —
    //     habitability ≈ 1.0, so the sector slot budget is the full 20)
    //   - !hasOwner — required for a SpawnIntent to land
    //   - prefer tiles with the most owned-by-no-one neighbors so we
    //     start in a contiguous unclaimed area instead of squeezing into
    //     a single-tile pocket already surrounded by AI nation territory
    //
    // We poll because nation factions seed in via `NationExecution.init`
    // a few ticks into the spawn phase. The first scan often runs before
    // any nation territory exists, which is fine — `hasOwner` is just
    // false everywhere then.
    const spawnTile = await page.waitForFunction(
      () => {
        const gv = (
          window as unknown as {
            __gameView?: {
              width(): number;
              height(): number;
              ref(x: number, y: number): unknown;
              isSector(ref: unknown): boolean;
              hasOwner(ref: unknown): boolean;
              terrainType(ref: unknown): number;
            };
          }
        ).__gameView;
        if (!gv) return false;
        const W = gv.width();
        const H = gv.height();
        const OPEN_SPACE = 0;
        let best: { x: number; y: number; freeNeighbors: number } | null = null;
        for (let y = 4; y < H - 4; y += 3) {
          for (let x = 4; x < W - 4; x += 3) {
            const r = gv.ref(x, y);
            if (!gv.isSector(r)) continue;
            if (gv.hasOwner(r)) continue;
            if (gv.terrainType(r) !== OPEN_SPACE) continue;
            // Score: count of unowned + sector neighbors in a small box.
            let free = 0;
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                const nr = gv.ref(x + dx, y + dy);
                if (gv.isSector(nr) && !gv.hasOwner(nr)) free++;
              }
            }
            if (best === null || free > best.freeNeighbors) {
              best = { x, y, freeNeighbors: free };
            }
          }
        }
        if (!best) return false;
        return { tileX: best.x, tileY: best.y };
      },
      null,
      { timeout: 30_000, polling: 500 },
    );
    const spawn = (await spawnTile.jsonValue()) as {
      tileX: number;
      tileY: number;
    };

    // Click the spawn tile via __emitClick — the same path SpaceMapPlane
    // takes when a player clicks the canvas during the spawn phase.
    await page.evaluate(
      ({ tileX, tileY }) => {
        const w = window as unknown as {
          __emitClick?: (x: number, y: number) => void;
        };
        w.__emitClick?.(tileX, tileY);
      },
      { tileX: spawn.tileX, tileY: spawn.tileY },
    );

    // Wait for the spawn intent to land as an alive player.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView?: {
            myPlayer?: () => { isAlive?: () => boolean } | null;
          };
        };
        return w.__gameView?.myPlayer?.()?.isAlive?.() === true;
      },
      null,
      { timeout: 60_000, polling: 250 },
    );

    // ── 2. Build a Spaceport on the spawn tile ─────────────────────────
    // The spawn tile is OpenSpace (full habitability) and freshly owned
    // by the local player, so the sector's structure-slot budget is
    // intact. We still pre-check via myPlayer.actions(tile, ['Spaceport'])
    // and pick the actual canBuild target the worker returns (the server
    // may shift placement for spacing).
    const spaceportLandedAt = await (async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const result = await page.evaluate(
          async ({ tx, ty }) => {
            const w = window as unknown as {
              __gameView: {
                ref(x: number, y: number): number;
                myPlayer(): {
                  smallID(): number;
                  actions(
                    tile: number,
                    units: string[],
                  ): Promise<{
                    buildableUnits: {
                      type: string;
                      canBuild: number | false;
                    }[];
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
            const mp = w.__gameView.myPlayer();
            if (!mp) return { ok: false as const };
            const eb = w.__eventBus;
            if (!eb) return { ok: false as const };
            let ctor: (new (...args: unknown[]) => object) | null = null;
            for (const [c] of eb.listeners) {
              if ((c as { name?: string }).name === "BuildUnitIntentEvent") {
                ctor = c as unknown as new (...args: unknown[]) => object;
                break;
              }
            }
            if (!ctor) return { ok: false as const };
            const tile = w.__gameView.ref(tx, ty);
            const actions = await mp.actions(tile, ["Spaceport"]);
            const sp = actions.buildableUnits.find(
              (b) => b.type === "Spaceport",
            );
            if (!sp || sp.canBuild === false) return { ok: false as const };
            eb.emit(new ctor("Spaceport", tile));
            return { ok: true as const, tile: sp.canBuild };
          },
          { tx: spawn.tileX, ty: spawn.tileY },
        );
        if (result.ok) return result.tile;
        await page.waitForTimeout(1_000);
      }
      return null;
    })();
    expect(
      spaceportLandedAt,
      "Spaceport never became buildable on the OpenSpace spawn tile within 30s",
    ).not.toBeNull();

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

    // ── 3. Find a nearby AsteroidField sector tile (the target) ────────
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
      const W = gv.width();
      const H = gv.height();
      const ASTEROID_FIELD = 2;
      // Spiral outward from the Spaceport tile — outer planet bands are
      // AsteroidField by construction, so this typically resolves within
      // ~80 tiles.
      for (let r = 1; r < 200; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const x = sp.x + dx;
            const y = sp.y + dy;
            if (x < 0 || x >= W || y < 0 || y >= H) continue;
            const ref = gv.ref(x, y);
            if (!gv.isSector(ref)) continue;
            if (gv.terrainType(ref) === ASTEROID_FIELD) return { x, y };
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

    // Compute a screen-space clip rectangle that frames both the
    // Spaceport and the AsteroidField target tile so the saved
    // screenshots actually show the action (a single tile flip is ~1px
    // at full-map zoom; clipping to the action zone makes scouts and
    // tile color changes legible).
    const clip = await page.evaluate(
      ([sx, sy, tx, ty]) => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const gv = (
          window as unknown as {
            __gameView?: { width(): number; height(): number };
          }
        ).__gameView;
        const cam = (
          window as unknown as {
            __threeCamera?: {
              updateMatrixWorld(force?: boolean): void;
              matrixWorldInverse: { elements: number[] };
              projectionMatrix: { elements: number[] };
            };
          }
        ).__threeCamera;
        if (!gv || !cam) return null;
        const mapW = gv.width();
        const mapH = gv.height();
        cam.updateMatrixWorld(true);
        const project = (tx: number, ty: number) => {
          const wx = tx - mapW / 2;
          const wy = -(ty - mapH / 2);
          const vm = cam.matrixWorldInverse.elements;
          const pm = cam.projectionMatrix.elements;
          const vx = vm[0] * wx + vm[4] * wy + vm[12];
          const vy = vm[1] * wx + vm[5] * wy + vm[13];
          const vz = vm[2] * wx + vm[6] * wy + vm[14];
          const vw = vm[3] * wx + vm[7] * wy + vm[15];
          const ppx = pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12] * vw;
          const ppy = pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13] * vw;
          const ppw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15] * vw;
          return {
            x: ((ppx / ppw + 1) / 2) * rect.width + rect.left,
            y: ((1 - ppy / ppw) / 2) * rect.height + rect.top,
          };
        };
        const a = project(sx, sy);
        const b = project(tx, ty);
        // Padding around the action zone so flight path + nearby map
        // structures are visible.
        const pad = 80;
        const x0 = Math.max(0, Math.min(a.x, b.x) - pad);
        const y0 = Math.max(0, Math.min(a.y, b.y) - pad);
        const x1 = Math.min(rect.right, Math.max(a.x, b.x) + pad);
        const y1 = Math.min(rect.bottom, Math.max(a.y, b.y) + pad);
        return {
          x: Math.floor(x0),
          y: Math.floor(y0),
          width: Math.ceil(x1 - x0),
          height: Math.ceil(y1 - y0),
        };
      },
      [spaceport.x, spaceport.y, targetTile!.x, targetTile!.y] as [
        number,
        number,
        number,
        number,
      ],
    );
    expect(
      clip,
      "could not project Spaceport+target tile to screen for clipped screenshot",
    ).not.toBeNull();

    // ── Screenshot 1: state BEFORE launch (clipped to action zone) ─────
    await page.screenshot({
      path: "test-results/scout-flow-01-before-scout-launch.png",
      clip: clip!,
    });

    // ── 4. Launch N scouts at the AsteroidField tile ───────────────────
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

    // ── Confirm the scouts spawned as actual ScoutSwarm units ──────────
    const scoutSpawnedCount = await page
      .waitForFunction(
        () => {
          const w = window as unknown as {
            __gameView: {
              myPlayer(): {
                units(t: string): { isActive(): boolean }[];
              } | null;
            };
          };
          const mp = w.__gameView.myPlayer();
          if (!mp) return false;
          const ss = mp.units("Scout Swarm");
          const live = ss.filter((u) => u.isActive()).length;
          return live > 0 ? live : false;
        },
        null,
        { timeout: 20_000, polling: 250 },
      )
      .then((h) => h.jsonValue() as Promise<number>);
    expect(scoutSpawnedCount).toBeGreaterThan(0);

    // ── Screenshot 2: scouts in flight (give them a few seconds) ───────
    // Wait for ScoutSwarms to be visibly mid-travel between Spaceport
    // and target before snapping. Speed is ~0.333 tiles/tick, so 5s of
    // wall-clock = ~17 tiles of travel.
    await page.waitForTimeout(5_000);
    await page.screenshot({
      path: "test-results/scout-flow-02-scouts-in-flight.png",
      clip: clip!,
    });

    // ── 5. Wait for the AsteroidField tile to step toward habitability ─
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

    // ── Screenshot 3: state AFTER terrain flip ─────────────────────────
    // Wait one extra second so any tick-driven re-render of the flipped
    // tile has settled.
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: "test-results/scout-flow-03-after-tile-flip.png",
      clip: clip!,
    });

    console.log(
      `[scout-flow] Spawn=(${spawn.tileX},${spawn.tileY}) ` +
        `Spaceport=(${spaceport.x},${spaceport.y}) ` +
        `Target=(${targetTile!.x},${targetTile!.y}) ` +
        `${TERRAIN_LABEL[initialTerrain]} → ${TERRAIN_LABEL[finalTerrain]} ` +
        `(${scoutSpawnedCount} scouts spawned at peak)`,
    );
  });
});
