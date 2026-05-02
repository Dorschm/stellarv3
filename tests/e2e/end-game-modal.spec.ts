import { expect, test } from "@playwright/test";
import {
  spawnLocalPlayer,
  startSingleplayerGame,
} from "./fixtures/game-fixtures";

/**
 * Regression coverage for the WinModal end-game screen.
 *
 * Players reported the "You won" / "You died" modal occasionally not
 * appearing at game end. Root cause: WinModal polled
 * `gameView.updatesSinceLastTick()` from a throttled `useGameTick(100)`
 * re-render. The Win update is one-shot — present only on the tick it
 * was emitted — and `lastUpdate` gets overwritten by the next tick.
 * During catch-up (multiple ticks land between renders) the Win update
 * was silently dropped before the React effect ran.
 *
 * The fix subscribes WinModal to `SceneTickEvent` directly, so every
 * tick's updates are observed exactly once regardless of render timing.
 *
 * These tests synthesize the SceneTickEvent that the server normally
 * emits, exercising the same listener path the production runner uses.
 */

test.describe("End-game modal (WinModal)", () => {
  test("appears with 'You won' when local player wins", async ({ page }) => {
    await startSingleplayerGame(page);
    await spawnLocalPlayer(page);

    const dispatched = await page.evaluate(async () => {
      const w = window as unknown as {
        __gameView: {
          ticks(): number;
          myPlayer(): { clientID(): string | null } | null;
        };
        __eventBus: { emit(event: unknown): void };
      };
      const myID = w.__gameView.myPlayer()?.clientID();
      if (myID === null || myID === undefined) return false;

      const dynamicImport = (0, eval)(
        "(u) => import(/* @vite-ignore */ u)",
      ) as (url: string) => Promise<unknown>;
      const inputHandler = (await dynamicImport(
        "/src/client/InputHandler.ts",
      )) as {
        SceneTickEvent: new (tick: number, updates: unknown) => unknown;
      };
      const updatesMod = (await dynamicImport(
        "/src/core/game/GameUpdates.ts",
      )) as {
        GameUpdateType: { Win: number };
      };

      const winUpdate = {
        type: updatesMod.GameUpdateType.Win,
        winner: ["player", myID] as const,
        allPlayersStats: {},
      };
      const updates: Record<number, unknown[]> = {};
      updates[updatesMod.GameUpdateType.Win] = [winUpdate];

      w.__eventBus.emit(
        new inputHandler.SceneTickEvent(w.__gameView.ticks(), updates),
      );
      return true;
    });
    expect(dispatched).toBe(true);

    await expect(page.getByText("You Won!", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("appears with 'has won' when another player wins", async ({ page }) => {
    await startSingleplayerGame(page);
    await spawnLocalPlayer(page);

    await page.evaluate(async () => {
      const w = window as unknown as {
        __gameView: { ticks(): number };
        __eventBus: { emit(event: unknown): void };
      };
      const dynamicImport = (0, eval)(
        "(u) => import(/* @vite-ignore */ u)",
      ) as (url: string) => Promise<unknown>;
      const inputHandler = (await dynamicImport(
        "/src/client/InputHandler.ts",
      )) as {
        SceneTickEvent: new (tick: number, updates: unknown) => unknown;
      };
      const updatesMod = (await dynamicImport(
        "/src/core/game/GameUpdates.ts",
      )) as {
        GameUpdateType: { Win: number };
      };

      const winUpdate = {
        type: updatesMod.GameUpdateType.Win,
        winner: ["nation", "Sirius Alliance"] as const,
        allPlayersStats: {},
      };
      const updates: Record<number, unknown[]> = {};
      updates[updatesMod.GameUpdateType.Win] = [winUpdate];

      w.__eventBus.emit(
        new inputHandler.SceneTickEvent(w.__gameView.ticks(), updates),
      );
    });

    await expect(
      page.getByText(/Nation Sirius Alliance has won!/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("appears with 'You died' when local player has no tiles", async ({
    page,
  }) => {
    await startSingleplayerGame(page);
    await spawnLocalPlayer(page);

    // Force the local player into the dead state by overriding
    // `isAlive` on the PlayerView instance. The view is reused across
    // ticks, so the override survives. Mutating `data.isAlive` directly
    // is not enough — the runner replaces `data` from PlayerUpdate
    // payloads every tick. WinModal's death detection runs on every
    // tick (useGameTick(0)), so the modal should appear shortly after.
    await page.evaluate(() => {
      const w = window as unknown as {
        __gameView: {
          myPlayer(): { isAlive: () => boolean } | null;
        };
      };
      const mp = w.__gameView.myPlayer();
      if (mp) mp.isAlive = () => false;
    });

    // Headless is slower than headed (less frequent rAF + tick events),
    // so allow more headroom than the win-update tests above.
    await expect(page.getByText("You died", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
});
