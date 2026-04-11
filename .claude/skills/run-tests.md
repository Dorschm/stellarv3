---
name: run-tests
description: Reference for running, filtering, and debugging OpenFront's Vitest + Playwright test suites
---

# Running Tests

## Unit / Integration Tests (Vitest)

```bash
# Full suite (recommended before committing)
npm test
# Equivalent: vitest run && vitest run tests/server

# Single file
npx vitest run tests/Attack.test.ts

# Pattern match (all files whose path includes "Nuke")
npx vitest run --reporter=verbose Nuke

# Watch mode (re-runs on save)
npx vitest tests/Attack.test.ts

# Coverage report (outputs to coverage/)
npm run test:coverage

# UI mode (browser-based test explorer)
npx vitest --ui
```

## E2E Tests (Playwright)

```bash
# Full E2E suite (headless)
npm run test:e2e

# Headed (browser visible — useful for debugging)
npm run test:e2e:headed

# Single spec file
npx playwright test tests/e2e/full-game.spec.ts

# With debug mode (step through)
npx playwright test --debug tests/e2e/full-game.spec.ts
```

## Performance Tests

```bash
npm run perf
# Runs tests/perf/run-all.ts via tsx
# Also see: tests/pathfinding/benchmark/
```

## Test file locations

```
tests/
├── *.test.ts                    Gameplay integration tests (Attack, Nuke, Alliance, etc.)
├── core/
│   ├── executions/*.test.ts     Per-Execution unit tests
│   ├── game/*.test.ts           Core game class tests
│   └── pathfinding/*.test.ts    Pathfinding algorithm tests
├── economy/*.test.ts            Economy formula tests
├── nukes/*.test.ts              Nuke/warhead behavior
├── integration/*.test.ts        GameView integration
├── client/*.test.ts             Client-side unit tests
└── e2e/*.spec.ts                Playwright E2E specs
```

## E2E suite — known skips

- `debug-planets.spec.ts` — diagnostic one-shot, not part of regular CI. Contains a
  pre-existing TS type error (`window as unknown as {...}`). Do not fix unless asked.
- Some multiplayer tests conditionally `test.skip` when procedural maps spawn unexpected
  nations (tracked in project memory as "procedural map nation pressure").

## Debugging a failing Vitest test

1. Run with `--reporter=verbose` to see individual test names.
2. Add `console.log(game.ticks(), player.numTilesOwned())` inside the test — `console.debug`
   is suppressed by `Setup.ts` but `console.log` is not.
3. Check that `game.inSpawnPhase()` has completed — many tests fail because an execution runs
   during the spawn phase when the map isn't fully initialized.
4. Ensure you called `game.executeNextTick()` enough times — `init()` runs on the tick after
   `addExecution()`, not immediately.

## Debugging a failing Playwright test

1. Run headed: `npm run test:e2e:headed`
2. Add `await page.pause()` to freeze at a specific point.
3. Check `tests/e2e/fixtures/game-fixtures.ts` for `startSingleplayerGame` — it handles
   navigating to the game and waiting for load.
4. Console errors from the browser appear in the Playwright output automatically if the
   test calls `page.on("console", ...)`.

## Vitest config

Vitest is configured inside `vite.config.ts` (the `test:` key). Key settings:

- `environment: "node"` for server tests
- `environment: "jsdom"` for client tests (check the config for per-file overrides)
- Canvas mock: `vitest-canvas-mock` is loaded globally for Pixi.js tests
