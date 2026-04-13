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

async function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => {
    const gv = (
      window as unknown as {
        __gameView: {
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

test.describe("AI behavior observation (headed run)", () => {
  test.setTimeout(20 * 60 * 1000); // up to 20 minutes

  test("observe AI ships, territory growth, and win condition", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await startSingleplayerGame(page);

    // Sanity: confirm the game exposes a WinCondition
    const cfg = await snapshot(page);

    console.log(
      `\n=== Game started — winCondition=${cfg.winCondition} numPlayers=${cfg.numPlayers} ===\n`,
    );
    expect(["elimination", "domination"]).toContain(cfg.winCondition);
    expect(cfg.numPlayers).toBeGreaterThan(1);

    const MAX_SAMPLES = 120;
    const SAMPLE_MS = 5_000;
    let lastSample: GameSnapshot | null = null;
    let firstShipTick: number | null = null;
    let firstDominantTick: number | null = null; // first tick any player has >=80%

    for (let i = 0; i < MAX_SAMPLES; i++) {
      const s = await snapshot(page);
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

      await page.waitForTimeout(SAMPLE_MS);
    }

    expect(lastSample).not.toBeNull();

    // Assertions — gentle, because we observe real game dynamics
    // 1. At least one AI nation should have built fleet ships
    expect(
      lastSample!.aiWithShips,
      "Expected at least one AI nation to have built ships (TradeFreighter/AssaultShuttle/Battlecruiser)",
    ).toBeGreaterThan(0);

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
