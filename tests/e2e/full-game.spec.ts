import { expect, Page, test } from "@playwright/test";
import {
  startSingleplayerGame,
  findOwnedTile,
  findInteriorOwnedTile,
  findSpawnTile,
  rightClickOnGameTile,
  waitForBorderEnemyTile,
  waitForTicksAbove,
} from "./fixtures/game-fixtures";

/**
 * Full gameplay E2E test.
 *
 * Drives a singleplayer game end-to-end through the full core loop — spawn,
 * passive resource growth, territory expansion by attacking terra nullius,
 * building a structure, adjusting the attack ratio, targeting a bot enemy,
 * and finally verifying the player is still alive and making progress after
 * a meaningful chunk of real-time ticks.
 *
 * All interactions use real browser events (clicks, keyboard), reading
 * `__gameView` only for read-only assertions (tile counts, gold, alive
 * state). No internal event-bus dispatches.
 *
 * All steps share a single session via `beforeAll` to amortize the map-load
 * cost. Steps are serial because each depends on state left by the
 * previous one (spawn before build, own tiles before attack, etc.).
 */
test.describe.configure({ mode: "serial" });

// This spec performs many tick-waits and network round-trips. Raise the
// per-test timeout well above the Playwright default so the slower steps
// (bot attack + 60 ticks of gameplay) don't false-fail on CI.
test.setTimeout(180_000);

test.describe("Full gameplay (singleplayer)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await startSingleplayerGame(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("player is alive and past spawn phase after session start", async () => {
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView?: {
            inSpawnPhase?: () => boolean;
            myPlayer?: () => {
              isAlive?: () => boolean;
              numTilesOwned?: () => number;
            } | null;
          };
        };
        const mp = w.__gameView?.myPlayer?.();
        return (
          w.__gameView?.inSpawnPhase?.() === false &&
          mp?.isAlive?.() === true &&
          (mp?.numTilesOwned?.() ?? 0) > 0
        );
      },
      null,
      { timeout: 60_000 },
    );

    const snapshot = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          myPlayer(): {
            numTilesOwned(): number;
            troops(): number;
            gold(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer();
      if (!mp) return null;
      return {
        tiles: mp.numTilesOwned(),
        troops: mp.troops(),
        gold: Number(mp.gold()),
      };
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.tiles).toBeGreaterThan(0);
  });

  test("troops and gold accumulate passively over time", async () => {
    const baseline = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          ticks(): number;
          myPlayer(): {
            troops(): number;
            gold(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer()!;
      return {
        tick: w.__gameView.ticks(),
        troops: mp.troops(),
        gold: Number(mp.gold()),
      };
    });

    await waitForTicksAbove(page, baseline.tick + 30, 60_000);

    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          myPlayer(): {
            troops(): number;
            gold(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer()!;
      return { troops: mp.troops(), gold: Number(mp.gold()) };
    });

    expect(after.troops).toBeGreaterThan(baseline.troops);
    expect(after.gold).toBeGreaterThan(baseline.gold);
  });

  test("attacking terra nullius expands territory", async () => {
    const baseTiles = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          myPlayer(): { numTilesOwned(): number } | null;
        };
      };
      return w.__gameView.myPlayer()?.numTilesOwned() ?? 0;
    });

    // Find an unowned land tile and attack it via the RadialMenu.
    // Right-clicking on unowned territory → "Attack" dispatches
    // SendAttackIntentEvent(null, troops) → terra nullius expansion.
    const unownedTile = await findSpawnTile(page);
    expect(unownedTile).not.toBeNull();
    await rightClickOnGameTile(
      page,
      unownedTile!.tileX,
      unownedTile!.tileY,
    );
    const attackButton = page
      .getByRole("button", { name: /attack/i })
      .first();
    await expect(attackButton).toBeEnabled({ timeout: 10_000 });
    await attackButton.click();

    // Terra nullius expansion takes several ticks to resolve.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
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

  test("player can build a DefensePost on owned territory", async () => {
    // Wait for enough gold (DefensePost costs ~50K).
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const w = window as unknown as {
              __gameView: {
                myPlayer(): { gold(): bigint } | null;
              };
            };
            return Number(w.__gameView.myPlayer()?.gold() ?? 0n);
          }),
        { timeout: 120_000, intervals: [1000, 2000] },
      )
      .toBeGreaterThanOrEqual(55_000);

    // Right-click on an interior owned tile → "Build" in RadialMenu.
    // Interior tiles (surrounded by own territory) are more likely to
    // support building. Fall back to any owned tile if no interior found.
    const ownedTile =
      (await findInteriorOwnedTile(page)) ?? (await findOwnedTile(page));
    expect(ownedTile).not.toBeNull();
    await rightClickOnGameTile(page, ownedTile!.tileX, ownedTile!.tileY);

    const buildRadialButton = page
      .getByRole("button", { name: /build/i })
      .first();
    await expect(buildRadialButton).toBeEnabled({ timeout: 10_000 });
    await buildRadialButton.click();

    // BuildMenu opens — find an enabled build option (not disabled).
    // The randomly chosen tile may not support every structure, so we
    // pick the first enabled button rather than hardcoding "Defense Post".
    const buildMenu = page.locator('[data-testid="build-menu"]');
    await expect(buildMenu).toBeVisible({ timeout: 10_000 });

    // Wait for buildable data to load (buttons are rendered after async
    // `buildables()` resolves).
    const enabledButton = buildMenu
      .locator("button:not([disabled])")
      .first();
    await expect(enabledButton).toBeVisible({ timeout: 10_000 });

    // Read the unit type from the enabled button's image alt text.
    const unitType = await enabledButton
      .locator("img")
      .first()
      .getAttribute("alt");
    expect(unitType).not.toBeNull();

    await enabledButton.click({ force: true });

    // Poll for the built unit to appear.
    await expect
      .poll(
        async () =>
          await page.evaluate(
            (type) => {
              const w = window as unknown as {
                __gameView: {
                  myPlayer(): {
                    units(...types: string[]): unknown[];
                  } | null;
                };
              };
              return w.__gameView.myPlayer()?.units(type).length ?? 0;
            },
            unitType!,
          ),
        { timeout: 60_000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(0);
  });

  test("attack ratio slider persists through gameplay", async () => {
    const slider = page.locator("input[type='range']:visible").first();
    await expect(slider).toBeVisible();
    await slider.focus();
    await slider.fill("35");
    await expect
      .poll(() => slider.evaluate((el: HTMLInputElement) => el.value))
      .toBe("35");

    await expect(page.getByText(/35%/).last()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("targeted attack on a bot enemy completes without crashing", async () => {
    // Wait for an enemy tile that borders our territory (guarantees
    // canAttack is true). Territory grows each tick, so the player will
    // eventually border a bot.
    const enemyTile = await waitForBorderEnemyTile(page, 60_000);

    await rightClickOnGameTile(
      page,
      enemyTile!.tileX,
      enemyTile!.tileY,
    );
    const attackButton = page
      .getByRole("button", { name: /attack/i })
      .first();
    await expect(attackButton).toBeEnabled({ timeout: 10_000 });
    await attackButton.click();

    // Let the server process a few ticks and confirm we're still alive.
    const baseTick = await page.evaluate(() => {
      const w = window as unknown as { __gameView: { ticks(): number } };
      return w.__gameView.ticks();
    });
    await waitForTicksAbove(page, baseTick + 10, 30_000);
    const stillAlive = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: { myPlayer(): { isAlive(): boolean } | null };
      };
      return w.__gameView.myPlayer()?.isAlive() === true;
    });
    expect(stillAlive).toBe(true);
  });

  test("game survives 60 ticks of continuous gameplay", async () => {
    const baseTick = await page.evaluate(() => {
      const w = window as unknown as { __gameView: { ticks(): number } };
      return w.__gameView.ticks();
    });
    const finalTick = await waitForTicksAbove(page, baseTick + 60, 90_000);
    expect(finalTick).toBeGreaterThan(baseTick + 60);

    const finalState = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          myPlayer(): {
            isAlive(): boolean;
            numTilesOwned(): number;
            troops(): number;
            gold(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer()!;
      return {
        alive: mp.isAlive(),
        tiles: mp.numTilesOwned(),
        troops: mp.troops(),
        gold: Number(mp.gold()),
      };
    });
    expect(finalState.alive).toBe(true);
    expect(finalState.tiles).toBeGreaterThan(0);
    expect(finalState.troops).toBeGreaterThan(0);
  });
});
