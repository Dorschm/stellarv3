---
name: add-intent-and-execution
description: End-to-end guide for adding a new player action (intent + Execution class) to OpenFront
---

# Adding a New Intent + Execution

Player actions follow a strict pipeline: client emits an Intent → server stamps it into a Turn →
`Executor.createExec()` constructs the corresponding Execution → game loop calls `init()` once
then `tick()` each game tick.

## Step 1 — Define the Intent schema in `src/core/Schemas.ts`

All intent types are Zod schemas, then unioned into the `Intent` type.

```typescript
// Add your schema (e.g., for a "scan_sector" action)
export const ScanSectorIntentSchema = z.object({
  type: z.literal("scan_sector"),
  clientID: ClientIDSchema,
  targetTile: z.number(),
});
export type ScanSectorIntent = z.infer<typeof ScanSectorIntentSchema>;

// Add to the Intent union (around line 30-54):
export type Intent =
  | ...existing...
  | ScanSectorIntent;

// Add to StampedIntentSchema (search for "stampedIntentSchema" or "TurnSchema"):
// It's usually a discriminated union — add your schema there too.
```

**File:** `src/core/Schemas.ts`

## Step 2 — Create the Execution class

Create `src/core/execution/ScanSectorExecution.ts`:

```typescript
import { Execution, Game, Player } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class ScanSectorExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private targetTile: TileRef,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false; // true only if needed before spawn
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    // Validate preconditions — deactivate instead of throwing
    if (!this.mg.isValidRef(this.targetTile)) {
      console.warn(`ScanSectorExecution: invalid tile ${this.targetTile}`);
      this.active = false;
      return;
    }
    // ... setup
  }

  tick(ticks: number): void {
    // Advance one tick of logic
    // Call this.active = false when done
  }

  isActive(): boolean {
    return this.active;
  }
}
```

**Rules:**

- Never use `Math.random()`. Use `PseudoRandom` seeded with a fixed value.
- Never throw. Set `this.active = false` and `return`.
- Store `mg: Game` in `init()`, not the constructor.
- `Credits` is `bigint` — arithmetic uses `0n`, `BigInt(n)`, not `0`.

## Step 3 — Wire the intent to the Execution in `ExecutionManager.ts`

File: `src/core/execution/ExecutionManager.ts` (class `Executor`, method `createExec`)

```typescript
case "scan_sector":
  return new ScanSectorExecution(player, intent.targetTile);
```

Add the import at the top of the file.

## Step 4 — Send the intent from the client

In the relevant HUD component or `InputHandler.ts`, call:

```typescript
// src/client/bridge/GameBridge.ts or relevant HUD component
transport.sendIntent({
  type: "scan_sector",
  clientID: myClientID,
  targetTile: tileRef,
});
```

`Transport` is available via context or bridge. The intent is routed through
`src/client/Transport.ts` → `LobbySocket` → server WebSocket.

## Step 5 — Add a test

See `tests/Attack.test.ts` or `tests/core/executions/` for examples.

```typescript
import { ScanSectorExecution } from "../src/core/execution/ScanSectorExecution";
import { setup } from "./util/Setup";

let game: Game;
beforeEach(async () => {
  game = await setup("ocean_and_land", { infiniteCredits: true });
  // ... spawn players
});

it("scans the sector", () => {
  game.addExecution(new ScanSectorExecution(player, targetTile));
  game.executeNextTick();
  // assert effects
});
```

## Files that must be updated together

| File                                        | Change                          |
| ------------------------------------------- | ------------------------------- |
| `src/core/Schemas.ts`                       | Add Intent schema + union entry |
| `src/core/execution/ScanSectorExecution.ts` | New file                        |
| `src/core/execution/ExecutionManager.ts`    | Add `case "scan_sector":`       |
| `src/client/Transport.ts` or HUD component  | Call `sendIntent()`             |
| `tests/...`                                 | Test the new execution          |

## Common pitfalls

- Forgetting to add the type to the `StampedIntentSchema` union (the `default: throw` in
  `createExec` will fire at runtime, not compile time).
- Using `Math.random()` — the server will desync from the client.
- Accessing `this.mg` before `init()` is called — it will be `undefined`.
- For `Credits`: `player.credits() >= cost` works, but `player.credits() - cost` returns `bigint`.
  Always pass `bigint` to `player.removeCredits()`.
