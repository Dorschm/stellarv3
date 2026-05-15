import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the production smoke test.
 *
 * Differences from the default `playwright.config.ts`:
 *   - No `webServer` entries — we hit https://stellar.game directly.
 *   - `testMatch` is narrowed to `prod-smoke.spec.ts`.
 *   - `baseURL` set to the prod origin (the spec also overrides this
 *     via `test.use`, but having it here means `npx playwright test`
 *     can be invoked without flags).
 *
 * Run headed:
 *   npx playwright test --config=playwright.prod.config.ts \
 *       --project=chromium --headed --reporter=list
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /prod-smoke\.spec\./,
  timeout: 180_000, // generous: real network + fresh first-load
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "https://stellar.game",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
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
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
