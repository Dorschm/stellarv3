import { expect, test } from "@playwright/test";
import {
  checkVisibleText,
  getConsoleErrors,
  spawnLocalPlayer,
  startMultiplayerGame,
  trackConsoleErrors,
  waitForTicksAbove,
} from "./fixtures/game-fixtures";

/**
 * Multiplayer sync E2E test.
 *
 * Boots two isolated browser contexts, routes them through the host/join
 * flow, and verifies that both clients converge on the same running game
 * state. Assertions stay intentionally loose (counts and inequalities
 * rather than exact values) to tolerate the per-run randomness of game
 * startup ordering.
 */
test.describe("multiplayer sync", () => {
  test("two players join a private lobby and remain in sync", async ({
    browser,
  }) => {
    const { host, guest } = await startMultiplayerGame(browser);
    trackConsoleErrors(host);
    trackConsoleErrors(guest);

    // Both pages landed in an `in-game` shell state — waitForInGame already
    // covers this, but re-asserting here keeps the failure message local to
    // this spec instead of the fixture.
    await expect
      .poll(
        () => host.evaluate(() => document.body.classList.contains("in-game")),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () => guest.evaluate(() => document.body.classList.contains("in-game")),
        { timeout: 10_000 },
      )
      .toBe(true);

    // Spawn both human players so they appear in the leaderboard.
    // Spawn sequentially — parallel spawning can race on the server when
    // both spawn intents arrive on the same tick.
    await spawnLocalPlayer(host, "top-left");
    await spawnLocalPlayer(guest, "bottom-right");

    // Capture the human player display names via __gameView (read-only).
    const hostName = await host.evaluate(() => {
      const w = window as unknown as {
        __gameView?: { myPlayer(): { displayName(): string } | null };
      };
      return w.__gameView?.myPlayer()?.displayName() ?? null;
    });
    const guestName = await guest.evaluate(() => {
      const w = window as unknown as {
        __gameView?: { myPlayer(): { displayName(): string } | null };
      };
      return w.__gameView?.myPlayer()?.displayName() ?? null;
    });
    expect(hostName).not.toBeNull();
    expect(guestName).not.toBeNull();

    // Assert both clients see both human player names via __gameView.
    // Using the data model instead of DOM assertions avoids fragility
    // caused by mobile/desktop dual-rendering of the leaderboard panel.
    for (const pg of [host, guest]) {
      await expect
        .poll(
          async () =>
            pg.evaluate(
              ({ hName, gName }) => {
                const gv = (
                  window as unknown as {
                    __gameView?: {
                      playerViews(): {
                        displayName(): string;
                        isAlive(): boolean;
                      }[];
                    };
                  }
                ).__gameView;
                if (!gv) return false;
                const names = gv
                  .playerViews()
                  .filter((p) => p.isAlive())
                  .map((p) => p.displayName());
                return names.includes(hName) && names.includes(gName);
              },
              { hName: hostName!, gName: guestName! },
            ),
          { timeout: 15_000 },
        )
        .toBe(true);
    }

    // Game ticks should advance on both clients.
    const hostTicks = await waitForTicksAbove(host, 0, 30_000);
    const guestTicks = await waitForTicksAbove(guest, 0, 30_000);
    expect(hostTicks).toBeGreaterThan(0);
    expect(guestTicks).toBeGreaterThan(0);

    // After a short settle period both clients should land on roughly the
    // same tick count. The server drives ticks deterministically, but
    // WebSocket delivery jitter can leave one client a couple of frames
    // ahead, so we allow ±2 slack.
    await host.waitForTimeout(2_000);
    const [finalHostTicks, finalGuestTicks] = await Promise.all([
      host.evaluate(() => {
        const w = window as unknown as { __gameView?: { ticks(): number } };
        return w.__gameView?.ticks?.() ?? 0;
      }),
      guest.evaluate(() => {
        const w = window as unknown as { __gameView?: { ticks(): number } };
        return w.__gameView?.ticks?.() ?? 0;
      }),
    ]);
    expect(Math.abs(finalHostTicks - finalGuestTicks)).toBeLessThanOrEqual(2);

    // Validate no console errors and no stale/untranslated text.
    const hostErrors = getConsoleErrors(host);
    const guestErrors = getConsoleErrors(guest);
    expect(hostErrors, "Unexpected console errors on host").toEqual([]);
    expect(guestErrors, "Unexpected console errors on guest").toEqual([]);

    const hostTextViolations = await checkVisibleText(host);
    const guestTextViolations = await checkVisibleText(guest);
    expect(
      hostTextViolations,
      "Stale terms or untranslated keys on host",
    ).toEqual([]);
    expect(
      guestTextViolations,
      "Stale terms or untranslated keys on guest",
    ).toEqual([]);

    await host.context().close();
    await guest.context().close();
  });
});
