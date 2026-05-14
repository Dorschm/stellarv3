import { expect, test } from "@playwright/test";

/**
 * Production smoke test — drives a real browser against https://stellar.game.
 *
 * The shipped prod build does NOT expose the `__gameView`, `__emitClick`,
 * `__threeCamera`, etc. debug hooks (they are only injected when
 * GAME_ENV !== "prod"; see RenderHtml.ts). It also does NOT honor `?e2e=1`
 * (no infiniteCredits / instantBuild). So this spec stays at the user-
 * observable surface only:
 *
 *   - HTTP 200 root + assets
 *   - lobby SPA mounts ("Single Player" / "Solo" CTA visible)
 *   - clicking Solo opens SinglePlayerModal
 *   - clicking Start Game lands the user `in-game` (body class) within
 *     a reasonable timeout
 *   - canvas element renders
 *   - no fatal console errors (Turnstile widget challenge noise filtered)
 *
 * Run headed: `npx playwright test tests/e2e/prod-smoke.spec.ts \
 *               --project=chromium --headed --reporter=list`
 *
 * The spec ignores the shared Vite/game-server webServer (passes
 * `?prod=1` is not needed; it just hits the prod URL via baseURL
 * override below).
 */

const PROD_URL = "https://stellar.game";

// Console errors we choose to ignore for the prod smoke. None of these
// indicate a real user-facing fault — the lobby loads, a game can be
// started, the canvas renders, and gameplay is unaffected.
const IGNORED_CONSOLE_RE = [
  /turnstile/i, // Cloudflare widget challenge noise
  /cosmetics|fetchCosmetics/i, // optional cosmetics API (self-hosted backend skips it)
  /profane.*words/i, // optional moderation API
  /Failed to fetch/i, // generic network noise (Turnstile / cosmetics)
  /service.worker/i,
  /cloudflareinsights/i,
  /sentry/i,
  // Anonymous JWT refresh-token poll: returns 503/401 in the self-hosted
  // backend until the user logs in. The lobby + game flows do not require
  // an authenticated session.
  /Refresh failed/i,
  /Failed to load resource.*\b(401|403|503)\b/i,
  // Pre-existing prod Content-Security-Policy warnings — the bundled
  // prod build sets `require-trusted-types-for` and a strict
  // `script-src 'nonce-…'` policy that some legacy inline scripts trip
  // over. These are warnings, not crashes; tracked separately.
  /TrustedHTML|TrustedScript|TrustedScriptURL/i,
  /Content Security Policy directive/i,
  // Console-art logger spam from a shipped library.
  /%c%d font-size:0;color:transparent NaN/i,
  // Three.js WebXR feature probe blocked by a strict Permissions-Policy
  // header. Three.js falls back to standard rendering — gameplay
  // unaffected.
  /Permissions policy violation: xr-spatial-tracking/i,
];

function shouldIgnore(text: string): boolean {
  return IGNORED_CONSOLE_RE.some((re) => re.test(text));
}

test.describe("stellar.game production smoke", () => {
  test.use({
    baseURL: PROD_URL,
    // Production may take a moment to TLS-handshake + serve the bundle.
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    // Don't trip on the self-signed-looking dev cert; prod has a real one
    // but accept either.
    ignoreHTTPSErrors: false,
  });

  test("lobby loads, single-player game starts, canvas renders", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const t = msg.text();
      if (shouldIgnore(t)) return;
      consoleErrors.push(t);
    });
    page.on("pageerror", (err) => {
      const t = err.message;
      if (shouldIgnore(t)) return;
      consoleErrors.push(`[pageerror] ${t}`);
    });

    // 1. /api/health responds 200 BEFORE we navigate
    const health = await page.request.get(`${PROD_URL}/api/health`);
    expect(health.status(), "/api/health should be 200").toBe(200);

    // 2. Root loads
    const resp = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(resp?.status(), "/ should be 200").toBe(200);

    // 3. Lobby CTA renders.
    //    PlayPage labels the singleplayer entry point via translateText("main.solo")
    //    which currently resolves to "Solo". The desktop layout shows "Solo"
    //    while the mobile layout shows "Single Player" — accept either.
    const soloButton = page
      .getByRole("button", { name: /^(solo|single ?player)$/i })
      .first();
    await expect(soloButton, "Solo / Single Player CTA visible").toBeVisible({
      timeout: 30_000,
    });

    // 4. Open the SinglePlayerModal
    await soloButton.click();
    const startButton = page
      .getByRole("button", { name: /^start game$/i })
      .first();
    await expect(startButton, "Start Game button visible").toBeVisible({
      timeout: 15_000,
    });

    // 5. Start Game — this triggers the in-browser game session
    await startButton.click();

    // 6. Body picks up the `in-game` marker once the client transitions.
    //    The prod build still adds this class — it is set in the client
    //    shell, not gated on GAME_ENV. Allow up to 90s: spawn-phase + map
    //    generation can take real wall time on first paint.
    await page.waitForFunction(
      () => document.body.classList.contains("in-game"),
      null,
      { timeout: 90_000 },
    );

    // 7. The 3D scene mounts a <canvas>. We don't probe Three.js internals
    //    (those globals aren't exposed in prod) — just confirm the canvas
    //    element exists and has non-zero size.
    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    const box = await canvas.boundingBox();
    expect(box, "canvas has bounding box").not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    // 8. Hold for a few ticks so any deferred startup error fires.
    await page.waitForTimeout(3_000);

    // 9. No unexpected console errors.
    if (consoleErrors.length > 0) {
      console.log("\n--- prod-smoke console errors ---");
      for (const e of consoleErrors) console.log("  •", e);
    }
    expect(
      consoleErrors,
      "production should log no fatal console errors",
    ).toEqual([]);
  });
});
