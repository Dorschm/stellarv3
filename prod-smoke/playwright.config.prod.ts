import { defineConfig, devices } from "@playwright/test";

/**
 * Production smoke test config — points at https://stellar.game.
 *
 * Unlike the main playwright.config.ts, this does NOT boot a local dev
 * server. It runs read-only smoke checks against the live site.
 *
 * Usage:
 *   # Both browsers headed:
 *   npx playwright test --config=prod-smoke/playwright.config.prod.ts --headed
 *
 *   # Firefox only:
 *   npx playwright test --config=prod-smoke/playwright.config.prod.ts \
 *     --project=firefox --headed
 *
 *   # Chromium only:
 *   npx playwright test --config=prod-smoke/playwright.config.prod.ts \
 *     --project=chromium --headed
 *
 * One-time prerequisite:
 *   npx playwright install firefox chromium
 */
export default defineConfig({
  testDir: ".",
  testMatch: /\.spec\./,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://stellar.game",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    ignoreHTTPSErrors: false,
    bypassCSP: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  // No webServer — we hit prod directly.
});
