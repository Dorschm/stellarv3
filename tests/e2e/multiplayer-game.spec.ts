import { expect, Page, test } from "@playwright/test";
import {
  checkVisibleText,
  findBorderUnownedTile,
  findOwnedTile,
  getConsoleErrors,
  rightClickOnGameTile,
  spawnLocalPlayer,
  startMultiplayerGame,
  trackConsoleErrors,
  waitForBorderEnemyTile,
  waitForImmunityEnd,
  waitForTicksAbove,
} from "./fixtures/game-fixtures";

/**
 * Full 2-player multiplayer game E2E test.
 *
 * Two browser contexts join a private lobby, spawn on different sides of the
 * map, and play through the full core loop — territory expansion, building,
 * attack-ratio adjustment, and attacking each other — all driven by real
 * mouse clicks on the canvas and HUD elements.
 *
 * All interactions use the real UI (pointer events on the R3F canvas, DOM
 * clicks on HUD elements). `__gameView` is used only for read-only
 * assertions (tile counts, alive state, tick counts).
 */
test.describe.configure({ mode: "serial" });

// Generous timeout — gold accrual + multiple real-time waits.
test.setTimeout(300_000);

test.describe("Full 2-player multiplayer game", () => {
  let host: Page;
  let guest: Page;

  test.beforeAll(async ({ browser }) => {
    const handles = await startMultiplayerGame(browser);
    host = handles.host;
    guest = handles.guest;
    trackConsoleErrors(host);
    trackConsoleErrors(guest);
  });

  test.afterAll(async () => {
    await host?.context().close();
    await guest?.context().close();
  });

  test("both players spawn on the map", async () => {
    // Spawn each player by clicking on a valid land tile via the canvas.
    // Spawn sequentially — spawning both simultaneously can race on
    // small maps where valid tile pools overlap.
    await spawnLocalPlayer(host);
    await spawnLocalPlayer(guest);
  });

  test("spawn phase ends and both players have territory", async () => {
    await Promise.all([
      host.waitForFunction(
        () => {
          const w = window as unknown as {
            __gameView?: { inSpawnPhase?: () => boolean };
          };
          return w.__gameView?.inSpawnPhase?.() === false;
        },
        null,
        { timeout: 60_000 },
      ),
      guest.waitForFunction(
        () => {
          const w = window as unknown as {
            __gameView?: { inSpawnPhase?: () => boolean };
          };
          return w.__gameView?.inSpawnPhase?.() === false;
        },
        null,
        { timeout: 60_000 },
      ),
    ]);

    const [hostTiles, guestTiles] = await Promise.all([
      host.evaluate(() => {
        const w = window as unknown as {
          __gameView: { myPlayer(): { numTilesOwned(): number } | null };
        };
        return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
      }),
      guest.evaluate(() => {
        const w = window as unknown as {
          __gameView: { myPlayer(): { numTilesOwned(): number } | null };
        };
        return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
      }),
    ]);
    expect(hostTiles).toBeGreaterThan(0);
    expect(guestTiles).toBeGreaterThan(0);
  });

  test("host expands territory by attacking unowned land", async () => {
    const baseTiles = await host.evaluate(() => {
      const w = window as unknown as {
        __gameView: { myPlayer(): { numTilesOwned(): number } | null };
      };
      return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
    });

    // Right-click on unowned land adjacent to our territory → "Attack".
    // Using findBorderUnownedTile guarantees `canAttack` will be true.
    const unownedTile = await findBorderUnownedTile(host);
    expect(unownedTile).not.toBeNull();
    await rightClickOnGameTile(host, unownedTile!.tileX, unownedTile!.tileY);
    const attackButton = host.getByRole("button", { name: /attack/i }).first();
    await expect(attackButton).toBeEnabled({ timeout: 30_000 });
    await attackButton.click();

    await expect
      .poll(
        async () =>
          host.evaluate(() => {
            const w = window as unknown as {
              __gameView: {
                myPlayer(): { numTilesOwned(): number } | null;
              };
            };
            return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
          }),
        { timeout: 45_000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(baseTiles);
  });

  test("guest also expands territory", async () => {
    const baseTiles = await guest.evaluate(() => {
      const w = window as unknown as {
        __gameView: { myPlayer(): { numTilesOwned(): number } | null };
      };
      return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
    });

    const unownedTile = await findBorderUnownedTile(guest);
    expect(unownedTile).not.toBeNull();
    await rightClickOnGameTile(guest, unownedTile!.tileX, unownedTile!.tileY);
    const attackButton = guest.getByRole("button", { name: /attack/i }).first();
    await expect(attackButton).toBeEnabled({ timeout: 30_000 });
    await attackButton.click();

    await expect
      .poll(
        async () =>
          guest.evaluate(() => {
            const w = window as unknown as {
              __gameView: {
                myPlayer(): { numTilesOwned(): number } | null;
              };
            };
            return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
          }),
        { timeout: 45_000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(baseTiles);
  });

  test("host adjusts attack ratio via HUD slider", async () => {
    const slider = host.locator("input[type='range']:visible").first();
    await expect(slider).toBeVisible({ timeout: 15_000 });
    await slider.focus();
    await slider.fill("60");
    await expect
      .poll(() => slider.evaluate((el: HTMLInputElement) => el.value))
      .toBe("60");
    await expect(host.getByText(/60%/).last()).toBeVisible({ timeout: 5_000 });
  });

  test("host right-clicks on owned tile to open build menu", async () => {
    const ownedTile = await findOwnedTile(host);
    expect(ownedTile).not.toBeNull();

    await rightClickOnGameTile(host, ownedTile!.tileX, ownedTile!.tileY);

    // Click "Build" in the RadialMenu.
    const buildButton = host.getByRole("button", { name: /build/i }).first();
    await expect(buildButton).toBeEnabled({ timeout: 10_000 });
    await buildButton.click();

    // Assert BuildMenu renders.
    const buildMenu = host.locator('[data-testid="build-menu"]');
    await expect(buildMenu).toBeVisible({ timeout: 10_000 });

    // Close via CloseViewEvent — using Escape would also open the
    // settings modal, which blocks subsequent tests.
    await host.evaluate(() => {
      const w = window as unknown as { __closeMenus?: () => void };
      w.__closeMenus?.();
    });
    await expect(buildMenu).toBeHidden({ timeout: 5_000 });
  });

  test("both clients see each other in playerViews", async () => {
    const [hostCount, guestCount] = await Promise.all([
      host.evaluate(() => {
        const w = window as unknown as {
          __gameView?: { playerViews(): unknown[] };
        };
        return w.__gameView?.playerViews?.().length ?? 0;
      }),
      guest.evaluate(() => {
        const w = window as unknown as {
          __gameView?: { playerViews(): unknown[] };
        };
        return w.__gameView?.playerViews?.().length ?? 0;
      }),
    ]);
    expect(hostCount).toBeGreaterThanOrEqual(2);
    expect(guestCount).toBeGreaterThanOrEqual(2);
    expect(hostCount).toBe(guestCount);
  });

  test("host attacks another player", async () => {
    // Wait for spawn immunity to expire so human players can attack.
    await waitForImmunityEnd(host, 60_000);

    // Wait for an enemy tile that borders the host's territory.
    const enemyTile = await waitForBorderEnemyTile(host, 90_000);

    await rightClickOnGameTile(host, enemyTile!.tileX, enemyTile!.tileY);
    const attackButton = host.getByRole("button", { name: /attack/i }).first();
    await expect(attackButton).toBeEnabled({ timeout: 30_000 });
    await attackButton.click();

    // Let the game process a few ticks and confirm the host is still alive.
    const baseTick = await host.evaluate(() => {
      const w = window as unknown as { __gameView: { ticks(): number } };
      return w.__gameView.ticks();
    });
    await waitForTicksAbove(host, baseTick + 10, 30_000);

    const hostAlive = await host.evaluate(() => {
      const w = window as unknown as {
        __gameView: { myPlayer(): { isAlive(): boolean } | null };
      };
      return w.__gameView.myPlayer()?.isAlive() === true;
    });
    expect(hostAlive).toBe(true);
  });

  test("guest attacks back", async () => {
    const enemyTile = await waitForBorderEnemyTile(guest, 90_000);

    await rightClickOnGameTile(guest, enemyTile!.tileX, enemyTile!.tileY);
    const attackButton = guest.getByRole("button", { name: /attack/i }).first();
    await expect(attackButton).toBeEnabled({ timeout: 30_000 });
    await attackButton.click();

    const baseTick = await guest.evaluate(() => {
      const w = window as unknown as { __gameView: { ticks(): number } };
      return w.__gameView.ticks();
    });
    await waitForTicksAbove(guest, baseTick + 10, 30_000);

    const guestAlive = await guest.evaluate(() => {
      const w = window as unknown as {
        __gameView: { myPlayer(): { isAlive(): boolean } | null };
      };
      return w.__gameView.myPlayer()?.isAlive() === true;
    });
    expect(guestAlive).toBe(true);
  });

  test("game survives 60 ticks with both players active", async () => {
    const [hostBaseTick, guestBaseTick] = await Promise.all([
      host.evaluate(() => {
        const w = window as unknown as { __gameView: { ticks(): number } };
        return w.__gameView.ticks();
      }),
      guest.evaluate(() => {
        const w = window as unknown as { __gameView: { ticks(): number } };
        return w.__gameView.ticks();
      }),
    ]);

    await Promise.all([
      waitForTicksAbove(host, hostBaseTick + 60, 90_000),
      waitForTicksAbove(guest, guestBaseTick + 60, 90_000),
    ]);

    const [hostState, guestState] = await Promise.all([
      host.evaluate(() => {
        const w = window as unknown as {
          __gameView: {
            myPlayer(): {
              isAlive(): boolean;
              numTilesOwned(): number;
              troops(): number;
            } | null;
          };
        };
        const mp = w.__gameView.myPlayer()!;
        return {
          alive: mp.isAlive(),
          tiles: mp.numTilesOwned(),
          troops: mp.troops(),
        };
      }),
      guest.evaluate(() => {
        const w = window as unknown as {
          __gameView: {
            myPlayer(): {
              isAlive(): boolean;
              numTilesOwned(): number;
              troops(): number;
            } | null;
          };
        };
        const mp = w.__gameView.myPlayer()!;
        return {
          alive: mp.isAlive(),
          tiles: mp.numTilesOwned(),
          troops: mp.troops(),
        };
      }),
    ]);
    expect(hostState.alive).toBe(true);
    expect(hostState.tiles).toBeGreaterThan(0);
    expect(hostState.troops).toBeGreaterThan(0);
    expect(guestState.alive).toBe(true);
    expect(guestState.tiles).toBeGreaterThan(0);
    expect(guestState.troops).toBeGreaterThan(0);
  });

  test("both clients remain in tick sync", async () => {
    const [hostTicks, guestTicks] = await Promise.all([
      host.evaluate(() => {
        const w = window as unknown as { __gameView?: { ticks(): number } };
        return w.__gameView?.ticks?.() ?? 0;
      }),
      guest.evaluate(() => {
        const w = window as unknown as { __gameView?: { ticks(): number } };
        return w.__gameView?.ticks?.() ?? 0;
      }),
    ]);
    expect(Math.abs(hostTicks - guestTicks)).toBeLessThanOrEqual(3);
  });

  test("no console errors and all visible text is correct", async () => {
    const hostErrors = getConsoleErrors(host);
    const guestErrors = getConsoleErrors(guest);
    expect(hostErrors, "Unexpected console errors on host").toEqual([]);
    expect(guestErrors, "Unexpected console errors on guest").toEqual([]);

    const hostTextViolations = await checkVisibleText(host);
    const guestTextViolations = await checkVisibleText(guest);
    expect(
      hostTextViolations,
      "Stale terms or untranslated keys on host",
    ).toEqual([]);
    expect(
      guestTextViolations,
      "Stale terms or untranslated keys on guest",
    ).toEqual([]);
  });
});
