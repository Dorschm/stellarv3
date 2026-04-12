---
name: add-test
description: How to write Vitest unit tests for OpenFront — setup(), fixtures, test maps, and patterns
---

# Adding a Test

## Test runner

OpenFront uses **Vitest** for unit/integration tests. Files ending in `.test.ts` under `tests/`
are picked up automatically.

```bash
# Run all unit tests
npm test

# Run a single file
npx vitest run tests/Attack.test.ts

# Run with watch
npx vitest tests/Attack.test.ts

# Coverage
npm run test:coverage
```

## Core setup pattern

Almost every test starts by calling `setup()` from `tests/util/Setup.ts`:

```typescript
import { setup } from "./util/Setup";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";

let game: Game;
const gameID = "test_game_id";

beforeEach(async () => {
  game = await setup("ocean_and_land", {
    infiniteCredits: true, // skip credit checks
    instantBuild: true, // zero construction time
    infinitePopulation: true, // skip population checks
    // bots: 0 (default — no AI)
  });

  // Create and spawn players
  const p1Info = new PlayerInfo("alice", PlayerType.Human, null, "alice_id");
  const p2Info = new PlayerInfo("bob", PlayerType.Human, null, "bob_id");
  game.addPlayer(p1Info);
  game.addPlayer(p2Info);

  game.addExecution(
    new SpawnExecution(gameID, p1Info, game.ref(0, 10)),
    new SpawnExecution(gameID, p2Info, game.ref(0, 20)),
  );

  // Advance past the spawn phase
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }

  player1 = game.player(p1Info.id);
  player2 = game.player(p2Info.id);
});
```

## Available test maps

Maps live in `tests/testdata/maps/`. Pass the directory name as the first arg to `setup()`:

| Map name               | Description                                 |
| ---------------------- | ------------------------------------------- |
| `ocean_and_land`       | Mixed terrain — good default for most tests |
| `plains`               | Flat open space, minimal terrain variation  |
| `big_plains`           | Larger version of plains                    |
| `half_land_half_ocean` | Equal sector / deep-space split             |
| `giantworldmap`        | Large map for pathfinding benchmarks        |
| `world`                | Real-world-shaped map                       |

**Never** reference `resources/maps/` from tests — those are production maps and inflate test time.

## Test utilities in `tests/util/utils.ts`

```typescript
import { constructionExecution, giveSpaceport } from "./util/utils";

// Build a structure for a player at a tile
constructionExecution(player, UnitType.Colony, tile);

// Give a player a spaceport (needed for some unit builds)
giveSpaceport(game, player, tile);
```

## Pathfinding test fixtures

Pathfinding tests use a separate fixtures file: `tests/core/pathfinding/_fixtures.ts`.
This exports small inline maps (as ASCII grids or constructed `GameMap` instances) so tests
don't need binary files. Reuse existing fixtures before creating new binary maps.

## E2E tests (`tests/e2e/`)

E2E tests use Playwright. Fixtures are in `tests/e2e/fixtures/game-fixtures.ts`:

```typescript
import { startSingleplayerGame } from "./fixtures/game-fixtures";

test("something in browser", async ({ page }) => {
  await startSingleplayerGame(page);
  // interact with the page
});
```

Run E2E tests:

```bash
npm run test:e2e        # headless
npm run test:e2e:headed # with browser visible
```

**Note:** `tests/e2e/debug-planets.spec.ts` has a pre-existing TS error and is a diagnostic
one-shot — not part of the regular suite. Don't break CI by accidentally including it without
`test.skip`.

## Advancing the game clock

```typescript
// Single tick
game.executeNextTick();

// N ticks
for (let i = 0; i < 20; i++) game.executeNextTick();

// Until a condition
while (!player.isAlive()) game.executeNextTick();
```

## Adding an execution mid-test

```typescript
game.addExecution(new AttackExecution(100, attacker, defender.id(), null));
game.executeNextTick(); // init() runs here
game.executeNextTick(); // first tick() runs here
```

## GameConfig options for TestConfig

Pass any partial `GameConfig` to `setup()`. Common flags:

```typescript
{
  infiniteCredits: true,      // player.credits() never depletes
  infinitePopulation: true,   // player.population() never depletes
  instantBuild: true,         // constructionDuration = 0
  randomSpawn: false,         // deterministic spawn positions
  bots: 0,                    // no AI players
  nations: "default",         // keep default nation behavior
}
```

## Directory placement

Mirror the `src/` structure under `tests/`:

| Source file                          | Test file location                           |
| ------------------------------------ | -------------------------------------------- |
| `src/core/execution/FooExecution.ts` | `tests/core/executions/FooExecution.test.ts` |
| `src/core/game/GameFoo.ts`           | `tests/core/game/GameFoo.test.ts`            |
| `src/core/pathfinding/...`           | `tests/core/pathfinding/...`                 |
| Cross-cutting gameplay               | `tests/FooFeature.test.ts` (top-level)       |
| Economy formulas                     | `tests/economy/`                             |
| Nuke behavior                        | `tests/nukes/`                               |
