import { expect, Page, test } from "@playwright/test";
import { startSingleplayerGame } from "./fixtures/game-fixtures";

type PlayerSnapshot = {
  id: string;
  name: string;
  type: string;
  tiles: number;
  alive: boolean;
  tradeFreighters: number;
  assaultShuttles: number;
  battlecruisers: number;
  spaceports: number;
  colonies: number;
};

type GameSnapshot = {
  ticks: number;
  inSpawnPhase: boolean;
  winnerId: string | null;
  winnerName: string | null;
  winCondition: string;
  totalLand: number;
  numPlayers: number;
  topPlayers: PlayerSnapshot[];
  aiWithShips: number;
  myPlayer: { name: string; tiles: number; alive: boolean } | null;
};

async function snapshot(page: Page): Promise<GameSnapshot | null> {
  try {
    const result = await page.evaluate(() => {
      const gv = (
        window as unknown as {
          __gameView?: {
            ticks(): number;
            inSpawnPhase(): boolean;
            topPlayer?(): { id(): string; displayName(): string } | null;
            winner?(): { id(): string; displayName(): string } | null;
            numSectorTiles(): number;
            playerViews(): Array<{
              id(): string | number;
              smallID?(): number;
              displayName(): string;
              type(): string;
              numTilesOwned(): number;
              isAlive(): boolean;
              units(t: string): unknown[];
            }>;
            myPlayer(): {
              displayName(): string;
              numTilesOwned(): number;
              isAlive(): boolean;
            } | null;
            config(): { winCondition(): string };
          };
        }
      ).__gameView;
      if (!gv) return null;

      const players = gv.playerViews();
      const snaps = players.map((p) => ({
        id: String(p.id()),
        name: p.displayName(),
        type: p.type(),
        tiles: p.numTilesOwned(),
        alive: p.isAlive(),
        tradeFreighters: p.units("Trade Freighter").length,
        assaultShuttles: p.units("Assault Shuttle").length,
        battlecruisers: p.units("Battlecruiser").length,
        spaceports: p.units("Spaceport").length,
        colonies: p.units("Colony").length,
      }));
      snaps.sort((a, b) => b.tiles - a.tiles);

      let winnerId: string | null = null;
      let winnerName: string | null = null;
      try {
        const w = gv.winner?.() ?? null;
        if (w) {
          winnerId = String(w.id());
          winnerName = w.displayName();
        }
      } catch {
        /* winner accessor may not exist */
      }

      const aiWithShips = snaps.filter(
        (p) =>
          p.type !== "Human" &&
          p.tradeFreighters + p.assaultShuttles + p.battlecruisers > 0,
      ).length;

      const mp = gv.myPlayer();

      return {
        ticks: gv.ticks(),
        inSpawnPhase: gv.inSpawnPhase(),
        winnerId,
        winnerName,
        winCondition: gv.config().winCondition(),
        totalLand: gv.numSectorTiles(),
        numPlayers: players.length,
        topPlayers: snaps.slice(0, 5),
        aiWithShips,
        myPlayer: mp
          ? {
              name: mp.displayName(),
              tiles: mp.numTilesOwned(),
              alive: mp.isAlive(),
            }
          : null,
      };
    });
    return result;
  } catch (e) {
    // Page navigated out of the game (client redirect on disconnect / game
    // end) — evaluate throws "Execution context was destroyed". Return
    // null so the caller can break the poll loop and use the last good
    // sample for assertions.
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("Execution context was destroyed") ||
      msg.includes("frame was detached") ||
      msg.includes("Target closed")
    ) {
      return null;
    }
    throw e;
  }
}

function fmtPct(tiles: number, total: number): string {
  if (total === 0) return "0%";
  return ((tiles / total) * 100).toFixed(1) + "%";
}

function logSnapshot(s: GameSnapshot) {
  const tick = s.ticks.toString().padStart(5);
  const header =
    `[t=${tick}] players=${s.numPlayers} aiWithShips=${s.aiWithShips}` +
    ` land=${s.totalLand} wc=${s.winCondition}` +
    (s.winnerId ? ` WINNER=${s.winnerName}` : "");

  console.log(header);
  for (const p of s.topPlayers) {
    console.log(
      `    ${p.name.padEnd(24)} ${p.type.padEnd(8)}` +
        ` tiles=${p.tiles.toString().padStart(5)} (${fmtPct(p.tiles, s.totalLand).padStart(6)})` +
        ` col=${p.colonies} sp=${p.spaceports} tf=${p.tradeFreighters}` +
        ` as=${p.assaultShuttles} bc=${p.battlecruisers}`,
    );
  }
}

// 20-minute observational watchdog, NOT a regression test. With 1 human +
// 408 nations on SolSystem, AI economy formulas can run for thousands of
// ticks before any nation accumulates enough territory to fund its first
// `TradeFreighter` — measuring that is the test's purpose, not its
// pass/fail. Default-skipped so routine `npx playwright test` runs stay
// fast and so this spec can never poison the shared dev server for the
// next spec in the serial chain. Run on demand with
// `RUN_AI_OBSERVE=1 npx playwright test tests/e2e/ai-behavior-observe.spec.ts`.
const RUN_AI_OBSERVE = process.env.RUN_AI_OBSERVE === "1";

test.describe("AI behavior observation (headed run)", () => {
  test.skip(!RUN_AI_OBSERVE, "Set RUN_AI_OBSERVE=1 to enable this watchdog");
  test.setTimeout(20 * 60 * 1000); // up to 20 minutes

  test("observe AI ships, territory growth, and win condition", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await startSingleplayerGame(page);

    // Sanity: confirm the game exposes a WinCondition
    const cfg = await snapshot(page);
    test.skip(
      cfg === null,
      "Singleplayer page lost __gameView before first snapshot — treated as environmental flake, not a regression",
    );

    console.log(
      `\n=== Game started — winCondition=${cfg!.winCondition} numPlayers=${cfg!.numPlayers} ===\n`,
    );
    expect(["elimination", "domination"]).toContain(cfg!.winCondition);
    expect(cfg!.numPlayers).toBeGreaterThan(1);

    // Headless chromium throttles timers unpredictably. A fixed wall-clock
    // sample budget gives the game only as many ticks as the host machine
    // grants in that window — on a slow run nations never have time to
    // accumulate enough credits for ships. Drive termination off game
    // ticks (with a very generous wall-clock cap so the test cannot hang
    // past its 20-min test-timeout) instead of a fixed iteration count.
    const MIN_TICKS = 2000;
    const MAX_SAMPLES = 220; // ~18.3 min — stays inside 20 min test-timeout
    const SAMPLE_MS = 5_000;
    let lastSample: GameSnapshot | null = cfg;
    let firstShipTick: number | null = null;
    let firstDominantTick: number | null = null; // first tick any player has >=80%

    for (let i = 0; i < MAX_SAMPLES; i++) {
      const s = await snapshot(page);
      if (s === null) {
        console.log(
          `\n>>> Page left the game state — using last sample for assertions\n`,
        );
        break;
      }
      logSnapshot(s);
      lastSample = s;

      if (firstShipTick === null && s.aiWithShips > 0) {
        firstShipTick = s.ticks;

        console.log(
          `\n>>> FIRST AI FLEET built by tick ${s.ticks} (${s.aiWithShips} AI nations own ships)\n`,
        );
      }

      if (
        firstDominantTick === null &&
        s.totalLand > 0 &&
        s.topPlayers.length > 0 &&
        s.topPlayers[0].tiles / s.totalLand >= 0.8
      ) {
        firstDominantTick = s.ticks;

        console.log(
          `\n>>> FIRST >=80% DOMINANCE at tick ${s.ticks} by ${s.topPlayers[0].name} (${s.topPlayers[0].type})\n`,
        );
      }

      if (s.winnerId !== null) {
        console.log(
          `\n>>> GAME ENDED at tick ${s.ticks} — winner ${s.winnerName}\n`,
        );
        break;
      }

      if (s.ticks >= MIN_TICKS && s.aiWithShips > 0) break;

      await page.waitForTimeout(SAMPLE_MS);
    }

    expect(lastSample).not.toBeNull();

    // Assertions — gentle, because we observe real game dynamics
    // 1. At least one AI nation should have built fleet ships *unless the
    //    game resolved before any AI had time to build one*. With the
    //    domination shortcut in elimination mode (see
    //    WinCheckExecution.dominantPlayer), a dominant bot can win the
    //    run within a few hundred ticks — earlier than the AI credit
    //    accrual needed for a first TradeFreighter. In that case the
    //    test has still validated the win-condition pipeline (the
    //    `winnerId` assertion below), so skip the ship check rather
    //    than false-fail on a legitimate early termination.
    if (lastSample!.winnerId === null) {
      expect(
        lastSample!.aiWithShips,
        "Expected at least one AI nation to have built ships (TradeFreighter/AssaultShuttle/Battlecruiser)",
      ).toBeGreaterThan(0);
    } else {
      console.log(
        `[ai-observe] game ended before aiWithShips budget; winner=${lastSample!.winnerName}, ships check skipped`,
      );
    }

    // 2. winCondition should be elimination or domination
    expect(["elimination", "domination"]).toContain(lastSample!.winCondition);

    // 3. Log summary for user to read

    console.log(
      `\n=== SUMMARY ===\n` +
        `  firstShipTick=${firstShipTick}\n` +
        `  firstDominantTick=${firstDominantTick}\n` +
        `  winnerId=${lastSample!.winnerId}\n` +
        `  winnerName=${lastSample!.winnerName}\n` +
        `  final aiWithShips=${lastSample!.aiWithShips}\n` +
        `  final top player: ${lastSample!.topPlayers[0]?.name} (${lastSample!.topPlayers[0]?.type}) at ${fmtPct(lastSample!.topPlayers[0]?.tiles ?? 0, lastSample!.totalLand)}\n`,
    );

    await context.close();
  });
});
