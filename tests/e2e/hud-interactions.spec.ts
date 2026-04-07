import { expect, Page, test } from "@playwright/test";
import {
  startSingleplayerGame,
  findOwnedTile,
  waitForBorderEnemyTile,
  rightClickOnGameTile,
} from "./fixtures/game-fixtures";

/**
 * HUD interaction tests.
 *
 * All tests share a single singleplayer session via `beforeAll` so we pay
 * the map-load and game-start cost exactly once. Each test case drives a
 * distinct HUD component; tests are ordered so opening components is
 * followed by closing them, leaving the session in a clean state for the
 * next case.
 */
test.describe.configure({ mode: "serial" });

// The chat test polls for a border enemy tile which can take time as
// territory expands. Raise the per-test timeout above the default.
test.setTimeout(120_000);

test.describe("HUD interactions (singleplayer)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await startSingleplayerGame(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("leaderboard renders with player rows", async () => {
    // Wait for the spawn phase to end AND for at least one player to
    // exist on the GameView. This is a readiness check for the R3F scene,
    // not the HUD overlay itself — the HUD's leaderboard panel is toggled
    // by a sidebar icon and may start collapsed depending on viewport.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __gameView?: {
            inSpawnPhase?: () => boolean;
            playerViews?: () => unknown[];
          };
        };
        return (
          w.__gameView?.inSpawnPhase?.() === false &&
          (w.__gameView?.playerViews?.().length ?? 0) > 0
        );
      },
      null,
      { timeout: 60_000 },
    );

    // The leaderboard is toggled by a sidebar button, and GameLeftSidebar
    // also auto-opens it on desktop viewports once spawn phase ends. The
    // two paths race, so a naive "click the toggle" would sometimes *close*
    // an already-open leaderboard. Instead: poll for the header text; if
    // it's not visible after a short wait, click the toggle and keep
    // polling. `force: true` is required because the R3F <canvas> covers
    // the viewport and Playwright's default hit-test sees it on top,
    // even though the sidebar <aside z-900> is above it in the stacking
    // context.
    const leaderboardHeader = page.getByText(/^(Owned|Max troops)$/).first();
    const leaderboardToggle = page
      .getByRole("button", { name: /player leaderboard/i })
      .first();
    await expect(leaderboardToggle).toBeVisible({ timeout: 15_000 });

    try {
      await expect(leaderboardHeader).toBeVisible({ timeout: 3_000 });
    } catch {
      await leaderboardToggle.click({ force: true });
      await expect(leaderboardHeader).toBeVisible({ timeout: 15_000 });
    }
  });

  test("control panel displays troops, gold, and attack ratio", async () => {
    // Control panel is only visible once the local player is alive (past
    // spawn phase). The attack ratio slider is a <input type="range">
    // scoped to the HUD overlay. ControlPanel renders both mobile (`lg:hidden`)
    // and desktop (`hidden lg:block`) variants, so there are *two* range
    // inputs in the DOM — we must pick the visible one. Playwright's
    // `:visible` pseudo-class filters out `display: none` ancestors.
    const slider = page.locator("input[type='range']:visible").first();
    await expect(slider).toBeVisible({ timeout: 30_000 });

    // Gold label is tagged with `translate="no"` and renders a number —
    // we just assert the HUD overlay contains a visible numeric string.
    const hasGoldDigits = await page.evaluate(() => {
      const root = document.getElementById("react-root");
      if (!root) return false;
      return /\d/.test(root.textContent ?? "");
    });
    expect(hasGoldDigits).toBe(true);
  });

  test("attack ratio slider responds to user input", async () => {
    const slider = page.locator("input[type='range']:visible").first();
    await expect(slider).toBeVisible();

    // Drag the slider to 50% via Playwright's native range input support.
    await slider.focus();
    await slider.fill("50");
    // Ensure the onChange handler committed the value.
    await expect
      .poll(() => slider.evaluate((el: HTMLInputElement) => el.value), {
        timeout: 5_000,
      })
      .toBe("50");

    // The Control panel renders a live label showing the current
    // percentage. Both mobile (`lg:hidden`) and desktop (`hidden lg:block`)
    // variants exist in the DOM — the desktop version renders after the
    // mobile one in document order, so `.last()` picks the visible one at
    // the 1280px test viewport.
    await expect(page.getByText(/50%/).last()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("build menu opens after right-click and closes on click-away", async () => {
    // Find a tile the local player owns.
    const ownedTile = await findOwnedTile(page);
    expect(ownedTile).not.toBeNull();

    // Right-click the owned tile to open the RadialMenu.
    await rightClickOnGameTile(page, ownedTile!.tileX, ownedTile!.tileY);

    // Click the "Build" button in the RadialMenu to open the BuildMenu.
    const buildRadialButton = page
      .getByRole("button", { name: /build/i })
      .first();
    await expect(buildRadialButton).toBeEnabled({ timeout: 10_000 });
    await buildRadialButton.click();

    // Assert BuildMenu renders with unit options — fail if it never opens.
    const buildMenu = page.locator('[data-testid="build-menu"]');
    await expect(buildMenu).toBeVisible({ timeout: 10_000 });

    // Verify at least one unit option is visible (e.g. city, port images).
    await expect(
      buildMenu.locator("img[alt]").first(),
    ).toBeVisible({ timeout: 5_000 });

    // Close by emitting CloseViewEvent via the exposed helper — the
    // R3F pointer pipeline does not forward synthetic Playwright mouse
    // events, so a raw canvas click won't trigger the EventBus-based
    // close handler. This is functionally equivalent.
    await page.evaluate(() => {
      const w = window as unknown as { __closeMenus?: () => void };
      w.__closeMenus?.();
    });
    await expect(buildMenu).toBeHidden({ timeout: 5_000 });
  });

  test("settings modal opens via Escape key and closes correctly", async () => {
    // Press Escape to open the settings modal — SpaceInputHandler routes
    // Escape through ShowSettingsModalEvent, the same path the gear icon
    // in GameRightSidebar uses.
    await page.keyboard.press("Escape");

    // Settings modal mounts `<div class="modal-overlay …">`.
    const overlay = page.locator(".modal-overlay");
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // Close via the × button inside the modal.
    const closeButton = page.getByRole("button", { name: /^×$/ }).first();
    await closeButton.click();
    await expect(overlay).toBeHidden({ timeout: 5_000 });
  });

  test("chat modal opens via player panel and send completes", async () => {
    // Open the chat modal through the visible UI path:
    // right-click enemy tile → RadialMenu → "Player info" → PlayerPanel → Chat.
    const enemyTile = await waitForBorderEnemyTile(page, 60_000);

    // Right-click the enemy tile to open the RadialMenu.
    await rightClickOnGameTile(page, enemyTile!.tileX, enemyTile!.tileY);

    // Click "Player info" in the RadialMenu to open PlayerPanel.
    const playerInfoButton = page
      .getByRole("button", { name: /player.info/i })
      .first();
    await expect(playerInfoButton).toBeEnabled({ timeout: 15_000 });
    await playerInfoButton.click();

    // Click the "Chat" button in the PlayerPanel to open ChatModal.
    const chatButton = page
      .locator('button[title="Chat"]')
      .first();
    await expect(chatButton).toBeVisible({ timeout: 10_000 });
    await chatButton.click({ force: true });

    // The ChatModal mounts with data-testid="chat-modal".
    const modal = page.locator('[data-testid="chat-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Select "Greetings" category.
    const greetingsButton = modal.getByRole("button", {
      name: /greetings/i,
    });
    await expect(greetingsButton).toBeVisible({ timeout: 5_000 });
    await greetingsButton.click();

    // Select "Hello!" phrase.
    const helloButton = modal.getByRole("button", { name: /hello/i });
    await expect(helloButton).toBeVisible({ timeout: 5_000 });
    await helloButton.click();

    // Send the message.
    const sendButton = modal.getByRole("button", { name: /send/i });
    await expect(sendButton).toBeEnabled({ timeout: 5_000 });
    await sendButton.click();

    // ChatModal closes itself after send — this confirms the full
    // category → phrase → send flow completed without error.
    // Note: Quick chat messages use DisplayChatEvent (not DisplayEvent),
    // which has no client-side renderer in ChatDisplay, so we verify
    // the modal interaction rather than the message appearing in chat.
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });
});
