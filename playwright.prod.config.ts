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
  // 1 retry is enough to absorb the transient prod-server throttling
  // we see when the 5-browser smoke fan-out hits stellar.game in a
  // burst (Solo button visibility check intermittently times out on
  // the 3rd or 4th browser in a row, then passes on retry).
  retries: 1,
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
    // Real Google Chrome (not Playwright's bundled chromium).
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    // Microsoft Edge — Chromium engine + Tracking Prevention defaults.
    {
      name: "edge",
      use: { ...devices["Desktop Chrome"], channel: "msedge" },
    },
    // Brave: Chromium driver + brave.exe so the run exercises Brave
    // Shields (ad/tracker/fingerprinting) on every navigation.
    {
      name: "brave",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
        launchOptions: {
          executablePath:
            process.env.BRAVE_EXECUTABLE ??
            `${process.env.LOCALAPPDATA ?? "C:\\Users\\Public\\AppData\\Local"}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        },
      },
    },
    // Opera: Chromium driver + opera.exe.
    {
      name: "opera",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
        launchOptions: {
          executablePath:
            process.env.OPERA_EXECUTABLE ??
            `${process.env.LOCALAPPDATA ?? "C:\\Users\\Public\\AppData\\Local"}\\Programs\\Opera\\opera.exe`,
        },
      },
    },
  ],
});
