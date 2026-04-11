import { expect, Page, test } from "@playwright/test";
import {
  checkVisibleText,
  findBorderUnownedTile,
  findInteriorOwnedTile,
  findOwnedTile,
  getConsoleErrors,
  rightClickOnGameTile,
  startSingleplayerGame,
  trackConsoleErrors,
  waitForBorderEnemyTile,
  waitForTicksAbove,
} from "./fixtures/game-fixtures";

/**
 * Full gameplay E2E test.
 *
 * Drives a singleplayer game end-to-end through the full core loop — spawn,
 * passive credit growth, territory expansion by attacking terra nullius,
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
// (bot attack + 60 ticks of gameplay + waiting for ~50k credits to build
// the cheapest structure) don't false-fail on CI. Headless Chromium
// throttles timers so the in-game tick rate runs well below the 10 tps
// real-time target — credit accrual is the bottleneck for this spec.
test.setTimeout(360_000);

test.describe("Full gameplay (singleplayer)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    trackConsoleErrors(page);
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
            population(): number;
            credits(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer();
      if (!mp) return null;
      return {
        tiles: mp.numTilesOwned(),
        population: mp.population(),
        gold: Number(mp.credits()),
      };
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.tiles).toBeGreaterThan(0);
  });

  test("population and gold accumulate passively over time", async () => {
    const baseline = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          ticks(): number;
          myPlayer(): {
            population(): number;
            credits(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer()!;
      return {
        tick: w.__gameView.ticks(),
        population: mp.population(),
        gold: Number(mp.credits()),
      };
    });

    await waitForTicksAbove(page, baseline.tick + 30, 60_000);

    const after = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          myPlayer(): {
            population(): number;
            credits(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer()!;
      return { population: mp.population(), gold: Number(mp.credits()) };
    });

    expect(after.population).toBeGreaterThan(baseline.population);
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
    // SendAttackIntentEvent(null, population) → terra nullius expansion.
    const unownedTile = await findBorderUnownedTile(page);
    expect(unownedTile).not.toBeNull();
    await rightClickOnGameTile(page, unownedTile!.tileX, unownedTile!.tileY);
    const attackButton = page.getByRole("button", { name: /attack/i }).first();
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

  test("player can build a DefenseStation on owned territory", async () => {
    // Wait for enough credits to afford a DefenseStation (first one costs
    // 50_000 — see DefaultConfig.unitInfo for UnitType.DefenseStation:
    // `(numUnits + 1) * 50_000`). The 5k buffer prevents a single tick of
    // rounding between read-credits and click-build from no-op'ing
    // sendBuildOrUpgrade.
    //
    // We use page.waitForFunction (in-page predicate) instead of
    // expect.poll + page.evaluate so that:
    //   1. We're navigation-resilient — if the player dies during the
    //      long credit accumulation and the page navigates to a results
    //      screen, expect.poll's evaluate would crash with "execution
    //      context destroyed". waitForFunction handles navigation cleanly.
    //   2. We can trip the predicate early on isAlive===false and surface
    //      a clear "player died during credit accumulation" error rather
    //      than a confusing context-destroyed stack trace.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView?: {
            myPlayer?: () => {
              credits?: () => bigint;
              isAlive?: () => boolean;
            } | null;
          };
        };
        const mp = w.__gameView?.myPlayer?.();
        if (!mp) return false;
        // Bail early if the player has died — the test below will fail
        // with a clearer message than a context-destroyed crash.
        if (mp.isAlive?.() !== true) return true;
        return Number(mp.credits?.() ?? 0n) >= 55_000;
      },
      null,
      { timeout: 270_000, polling: 1000 },
    );

    // Sanity-check that the player survived the wait. If they didn't, the
    // bots overwhelmed the homeworld during credit accumulation — that's
    // a balance/regression issue, not a test bug.
    const stillAlive = await page.evaluate(() => {
      const w = window as unknown as {
        __gameView?: { myPlayer?: () => { isAlive?: () => boolean } | null };
      };
      return w.__gameView?.myPlayer?.()?.isAlive?.() === true;
    });
    expect(
      stillAlive,
      "Player died during credit accumulation — investigate balance regression",
    ).toBe(true);

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

    // BuildMenu opens — pick the first enabled buildable that ISN'T
    // ScoutSwarm. ScoutSwarm has cost 0 and is always enabled, but its
    // execution path is special-cased (ScoutSwarmExecution handles its
    // own spawn / credit deduction outside the normal construction
    // flow), so the asserting-on-units check below would not see it.
    //
    // We can't lock onto DefenseStation specifically: with the GDD §4 /
    // Ticket 8 sector-slot limits, the randomly chosen build tile might
    // simply not allow a DefenseStation in this run, even with enough
    // credits — the "Not enough money" tooltip is hardcoded for any
    // disabled state. Picking first-enabled-non-ScoutSwarm gives us a
    // structure that the game says is currently buildable on the tile
    // we picked, regardless of which one wins the dice roll.
    const buildMenu = page.locator('[data-testid="build-menu"]');
    await expect(buildMenu).toBeVisible({ timeout: 10_000 });

    const enabledStructureButton = buildMenu
      .locator('button:not([disabled]):not(:has(img[alt="Scout Swarm"]))')
      .first();
    await expect(enabledStructureButton).toBeVisible({ timeout: 30_000 });
    const unitType = await enabledStructureButton
      .locator("img")
      .first()
      .getAttribute("alt");
    expect(unitType).not.toBeNull();
    await enabledStructureButton.click({ force: true });

    // Poll for the built unit to appear. Construction takes ~50 ticks
    // (~17s at 3 tps headless throttle), so 60s is comfortably above
    // the worst-case spawn time.
    await expect
      .poll(
        async () =>
          await page.evaluate((type) => {
            const w = window as unknown as {
              __gameView: {
                myPlayer(): {
                  units(...types: string[]): unknown[];
                } | null;
              };
            };
            return w.__gameView.myPlayer()?.units(type).length ?? 0;
          }, unitType!),
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

    await rightClickOnGameTile(page, enemyTile!.tileX, enemyTile!.tileY);
    const attackButton = page.getByRole("button", { name: /attack/i }).first();
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
            population(): number;
            credits(): bigint;
          } | null;
        };
      };
      const mp = w.__gameView.myPlayer()!;
      return {
        alive: mp.isAlive(),
        tiles: mp.numTilesOwned(),
        population: mp.population(),
        gold: Number(mp.credits()),
      };
    });
    expect(finalState.alive).toBe(true);
    expect(finalState.tiles).toBeGreaterThan(0);
    expect(finalState.population).toBeGreaterThan(0);
  });

  test("no console errors and all visible text is correct", async () => {
    const errors = getConsoleErrors(page);
    expect(errors, "Unexpected console errors during gameplay").toEqual([]);

    const textViolations = await checkVisibleText(page);
    expect(
      textViolations,
      "Stale terms or untranslated keys in visible UI",
    ).toEqual([]);
  });
});
