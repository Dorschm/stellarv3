import { expect, test } from "@playwright/test";

import {
  clickOnGameTile,
  findOwnedTile,
  startSingleplayerGame,
} from "./fixtures/game-fixtures";

/**
 * Regression spec for the user-reported "I can no longer select the
 * battlecruiser and move it" complaint.
 *
 * Flow:
 *   1. Start singleplayer with ?e2e=1 (instant build, infinite credits).
 *   2. Spawn the local player.
 *   3. Build a Spaceport on owned tile (warshipSpawn requires a port).
 *   4. Build a Battlecruiser.
 *   5. Wait for the cruiser to be active.
 *   6. Click on the cruiser's tile via the canvas.
 *   7. Assert HUDStore.selectedBattlecruiserUnitId === cruiser.id.
 *   8. Click on a different tile.
 *   9. Assert a "move_battlecruiser" intent was sent (Transport sniff).
 *
 * Diagnostic-grade: if the cruiser never builds (port spawn rules
 * changed) or never lands, the spec skips with a descriptive message
 * so it doesn't false-fail the suite.
 */

test.describe("Capital ship select+move (regression for issue #4)", () => {
  test("left-click selects an owned cruiser; second click issues a move", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await startSingleplayerGame(page);

    // ── Build a Spaceport (Battlecruiser requires nearby spaceport) ──────
    const spaceportLanded = await page.evaluate(async () => {
      const w = window as unknown as {
        __gameView: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          owner(ref: unknown): { smallID(): number };
          isSector(ref: unknown): boolean;
          myPlayer(): {
            smallID(): number;
            actions(
              tile: unknown,
              units: string[],
            ): Promise<{
              buildableUnits: { type: string; canBuild: unknown | false }[];
            }>;
          } | null;
        };
        __eventBus: {
          listeners: Map<{ name: string }, unknown>;
          emit(event: object): void;
        };
      };
      const mp = w.__gameView.myPlayer();
      if (!mp) return false;
      const eb = w.__eventBus;
      let ctor: (new (...args: unknown[]) => object) | null = null;
      for (const [c] of eb.listeners) {
        if ((c as { name?: string }).name === "BuildUnitIntentEvent") {
          ctor = c as unknown as new (...args: unknown[]) => object;
          break;
        }
      }
      if (!ctor) return false;
      const myID = mp.smallID();
      const W = w.__gameView.width();
      const H = w.__gameView.height();
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const r = w.__gameView.ref(x, y);
          if (!w.__gameView.isSector(r)) continue;
          const o = w.__gameView.owner(r);
          if (!o || o.smallID() !== myID) continue;
          const a = await mp.actions(r, ["Spaceport"]);
          const sp = a.buildableUnits.find((b) => b.type === "Spaceport");
          if (sp && sp.canBuild !== false) {
            eb.emit(new ctor("Spaceport", r));
            return true;
          }
        }
      }
      return false;
    });
    test.skip(
      !spaceportLanded,
      "could not find a tile that accepts a Spaceport on this seed",
    );

    // Wait for the Spaceport to actually exist
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView?: {
            myPlayer(): {
              units(t: string): { isActive(): boolean }[];
            } | null;
          };
        };
        const mp = w.__gameView?.myPlayer();
        return mp ? mp.units("Spaceport").some((u) => u.isActive()) : false;
      },
      null,
      { timeout: 30_000, polling: 250 },
    );

    // ── Diagnose: count void tiles + sample one's actions() ─────────────
    const diag = await page.evaluate(async () => {
      const w = window as unknown as {
        __gameView: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          isVoid(ref: unknown): boolean;
          myPlayer(): {
            actions(
              tile: unknown,
              units: string[],
            ): Promise<{
              buildableUnits: { type: string; canBuild: unknown | false }[];
            }>;
          } | null;
        };
      };
      const W = w.__gameView.width();
      const H = w.__gameView.height();
      let voidCount = 0;
      let firstVoid: { x: number; y: number; tile: unknown } | null = null;
      for (let y = 0; y < H; y += 4) {
        for (let x = 0; x < W; x += 4) {
          const r = w.__gameView.ref(x, y);
          if (w.__gameView.isVoid(r)) {
            voidCount++;
            firstVoid ??= { x, y, tile: r };
          }
        }
      }
      const mp = w.__gameView.myPlayer();
      let sample: unknown = null;
      if (firstVoid && mp) {
        const a = await mp.actions(firstVoid.tile, ["Battlecruiser"]);
        sample = { firstVoid: { x: firstVoid.x, y: firstVoid.y }, actions: a };
      }
      return { voidCount, sample };
    });
    console.log("[cap-ship] diag:", JSON.stringify(diag, null, 2));

    // ── Build a Battlecruiser ────────────────────────────────────────────
    // Battlecruiser canBuild → warshipSpawn(tile) requires a VOID tile
    // (deep space) and a nearby active Spaceport. Find a void tile near
    // owned territory and target that.
    const cruiserLanded = await page.evaluate(async () => {
      const w = window as unknown as {
        __gameView: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          owner(ref: unknown): { smallID(): number };
          isVoid(ref: unknown): boolean;
          isSector(ref: unknown): boolean;
          myPlayer(): {
            smallID(): number;
            actions(
              tile: unknown,
              units: string[],
            ): Promise<{
              buildableUnits: { type: string; canBuild: unknown | false }[];
            }>;
          } | null;
        };
        __eventBus: {
          listeners: Map<{ name: string }, unknown>;
          emit(event: object): void;
        };
      };
      const mp = w.__gameView.myPlayer();
      if (!mp) return false;
      const eb = w.__eventBus;
      let ctor: (new (...args: unknown[]) => object) | null = null;
      for (const [c] of eb.listeners) {
        if ((c as { name?: string }).name === "BuildUnitIntentEvent") {
          ctor = c as unknown as new (...args: unknown[]) => object;
          break;
        }
      }
      if (!ctor) return false;
      const W = w.__gameView.width();
      const H = w.__gameView.height();
      // Spiral the whole map in a coarse grid; first void tile that
      // canBuild=true wins.
      for (let y = 0; y < H; y += 4) {
        for (let x = 0; x < W; x += 4) {
          const r = w.__gameView.ref(x, y);
          if (!w.__gameView.isVoid(r)) continue;
          const a = await mp.actions(r, ["Battlecruiser"]);
          const bc = a.buildableUnits.find((b) => b.type === "Battlecruiser");
          if (bc && bc.canBuild !== false) {
            eb.emit(new ctor("Battlecruiser", r));
            return true;
          }
        }
      }
      return false;
    });
    test.skip(
      !cruiserLanded,
      "could not find a tile where Battlecruiser is buildable on this seed",
    );

    // Wait for the Battlecruiser to land as an active unit; capture its
    // tile coordinates so we can click on it.
    const cruiserHandle = await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView: {
            x(t: unknown): number;
            y(t: unknown): number;
            myPlayer(): {
              units(t: string): {
                id(): number;
                isActive(): boolean;
                tile(): unknown;
              }[];
            } | null;
          };
        };
        const mp = w.__gameView.myPlayer();
        if (!mp) return false;
        const live = mp.units("Battlecruiser").find((u) => u.isActive());
        if (!live) return false;
        return {
          id: live.id(),
          tileX: w.__gameView.x(live.tile()),
          tileY: w.__gameView.y(live.tile()),
        };
      },
      null,
      { timeout: 60_000, polling: 250 },
    );
    const cruiser = (await cruiserHandle.jsonValue()) as {
      id: number;
      tileX: number;
      tileY: number;
    };
    console.log(
      `[cap-ship] cruiser id=${cruiser.id} at (${cruiser.tileX}, ${cruiser.tileY})`,
    );

    // ── Install probes: HUD store getState + move-intent sniffer ───────
    // Zustand store is a module export, not a window global. Reach it
    // via dynamic import (the same trick scout-flow uses for the
    // BuildUnitIntentEvent constructor).
    await page.evaluate(async () => {
      const w = window as unknown as {
        __hudGetState?: () => {
          selectedBattlecruiserUnitId: number | null;
        };
        __capturedMoveIntents?: { unitId: number; tile: unknown }[];
        __eventBus: {
          listeners: Map<{ name: string }, unknown>;
          on(ctor: unknown, handler: (e: unknown) => void): void;
        };
      };
      const dynamicImport = (0, eval)(
        "(u) => import(/* @vite-ignore */ u)",
      ) as (url: string) => Promise<unknown>;
      const hudMod = (await dynamicImport(
        "/src/client/bridge/HUDStore.ts",
      )) as {
        useHUDStore: {
          getState(): { selectedBattlecruiserUnitId: number | null };
        };
      };
      w.__hudGetState = () => hudMod.useHUDStore.getState();

      w.__capturedMoveIntents = [];
      let moveCtor: unknown = null;
      for (const [c] of w.__eventBus.listeners) {
        if ((c as { name?: string }).name === "MoveBattlecruiserIntentEvent") {
          moveCtor = c;
          break;
        }
      }
      if (moveCtor) {
        w.__eventBus.on(moveCtor, (e) => {
          const ev = e as { unitId: number; tile: unknown };
          w.__capturedMoveIntents!.push({ unitId: ev.unitId, tile: ev.tile });
        });
      }
    });

    // ── Step 1: click ON the cruiser tile → should select ──────────────
    await clickOnGameTile(page, cruiser.tileX, cruiser.tileY);
    await page.waitForFunction(
      (id) => {
        // Read selectedBattlecruiserUnitId from the Zustand store via
        // its module exports. Zustand mounts state on the hook fn itself
        // under `getState()`; we expose the hook globally via a one-shot
        // bridge below.
        const w = window as unknown as {
          __hudGetState?: () => { selectedBattlecruiserUnitId: number | null };
        };
        // Lazy hook: install a probe the first time waitForFunction runs.
        if (!w.__hudGetState) {
          // Shouldn't happen — installed below before clicking.
        }
        return w.__hudGetState?.().selectedBattlecruiserUnitId === id;
      },
      cruiser.id,
      { timeout: 5_000, polling: 100 },
    );
    const selectedId = await page.evaluate(() => {
      const w = window as unknown as {
        __hudGetState?: () => { selectedBattlecruiserUnitId: number | null };
      };
      return w.__hudGetState?.().selectedBattlecruiserUnitId ?? null;
    });
    expect(selectedId, "cruiser should be selected after click").toBe(
      cruiser.id,
    );

    // ── Step 2: click somewhere else → should issue a move ─────────────
    const ownedNotCruiser = await findOwnedTile(page);
    expect(
      ownedNotCruiser,
      "need at least one owned non-cruiser tile to click as the move target",
    ).not.toBeNull();

    await clickOnGameTile(page, ownedNotCruiser!.tileX, ownedNotCruiser!.tileY);
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __capturedMoveIntents?: { unitId: number }[];
        };
        return (w.__capturedMoveIntents?.length ?? 0) > 0;
      },
      null,
      { timeout: 5_000, polling: 100 },
    );
    const intents = await page.evaluate(() => {
      const w = window as unknown as {
        __capturedMoveIntents?: { unitId: number }[];
      };
      return w.__capturedMoveIntents ?? [];
    });
    expect(intents.length).toBeGreaterThan(0);
    expect(intents[0].unitId).toBe(cruiser.id);
    console.log(
      `[cap-ship] move intent emitted unitId=${intents[0].unitId} — select+move flow OK`,
    );
  });
});
