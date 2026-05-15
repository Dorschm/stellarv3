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
    // Brave is Chromium under the hood (so it inherits Playwright's
    // chromium driver) plus a default-on Brave Shields layer that
    // blocks ad/tracker requests, restricts third-party cookies, and
    // tightens fingerprinting. We point the chromium driver at the
    // user-installed brave.exe so the run exercises the real shields
    // path on every page navigation. If brave.exe is not installed at
    // the standard Windows location this project simply errors out at
    // launch — the rest of the suite still runs.
    {
      name: "brave",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
        launchOptions: {
          executablePath:
            process.env.BRAVE_EXECUTABLE ??
            // Default install location on Windows (winget / direct
            // installer both land here for the per-user install).
            `${process.env.LOCALAPPDATA ?? "C:\\Users\\Public\\AppData\\Local"}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        },
      },
    },
  ],
});
