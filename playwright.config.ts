import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for E2E browser tests.
 *
 * These tests boot both the Vite dev server (port 9000) and the Node game
 * server (port 3000) via the `webServer` entries below. They are intentionally
 * kept out of the Vitest suite — run them with `npm run test:e2e` (headless)
 * or `npm run test:e2e:headed` for visual debugging.
 */
export default defineConfig({
  testDir: "tests/e2e",
  // Run all E2E specs in the test directory.
  testMatch: /\.spec\./,
  // 60s used to be enough but the procedural map generator + sector-map
  // habitability bake-in + 3rd-game cumulative bundle/JIT load can push a
  // single `startSingleplayerGame` to ~30-60s in headless Chromium. Tests
  // that do startSingleplayerGame → action → assertion need headroom on
  // top of that. 120s keeps the suite robust without hiding real hangs.
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  // Serial execution keeps the shared Vite/game server stable across specs.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:9000",
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
  webServer: [
    {
      command: "cross-env GAME_ENV=dev tsx src/server/Server.ts",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "cross-env SKIP_BROWSER_OPEN=true npx vite",
      port: 9000,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
