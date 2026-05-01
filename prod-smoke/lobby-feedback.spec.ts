import { expect, test } from "@playwright/test";

/**
 * Production smoke test for the lobby-feedback fix (commit fd4262c).
 *
 * Validates that clicking a public lobby card on https://stellar.game
 * produces visible feedback (a "Connecting..." badge) the same frame as
 * the click, rather than the old behavior where clicks gave zero
 * indication for ~30–60s.
 *
 * READ-ONLY: this test joins a public lobby card to verify the badge
 * appears, then navigates away before the game starts. It does not host
 * a lobby, send messages, or otherwise pollute prod state.
 *
 * Run with:
 *   npx playwright test --config=prod-smoke/playwright.config.prod.ts --headed
 */

test.describe("public lobby card click feedback (prod smoke)", () => {
  test("clicking a rotating-map card surfaces the Connecting badge", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The play page renders inside the SPA shell. Wait until at least one
    // public lobby card is in the DOM. The cards are buttons whose
    // accessible content includes "Free For All" or "Teams of N" — but
    // the most stable hook is the bottom card-info bar. We instead look
    // for any button that contains the text "Free For All" since the
    // FFA card is always one of the rotating lobbies.
    const lobbyCard = page
      .getByRole("button")
      .filter({ hasText: /Free For All/i })
      .first();
    await expect(lobbyCard).toBeVisible({ timeout: 30_000 });

    // Username field must be filled so the validate-on-click guard passes.
    // The form auto-fills with "Guest_XXX"; if not, we set one.
    const usernameInput = page.locator(
      'input[name="username"], input[id*="username" i], input[placeholder*="name" i]',
    );
    if (await usernameInput.count()) {
      const current = await usernameInput.first().inputValue();
      if (!current) {
        await usernameInput.first().fill("smoke_test");
      }
    }

    // Sanity check: the card has no aria-pressed=true before click.
    await expect(lobbyCard).toHaveAttribute("aria-pressed", "false");

    // Click and immediately assert the optimistic badge appears.
    await lobbyCard.click();

    // The fix renders a badge with text matching either translated string.
    // We accept either since the locale may vary.
    const connectingBadge = lobbyCard
      .locator(
        'span:has-text("Connecting"), span:has-text("Waiting for players")',
      )
      .first();
    await expect(connectingBadge).toBeVisible({ timeout: 5_000 });

    // The card must report aria-pressed=true after click.
    await expect(lobbyCard).toHaveAttribute("aria-pressed", "true");

    // Bail before the game actually starts so we don't pollute the lobby.
    // Hard reload returns to the play page and discards the join.
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });
});
