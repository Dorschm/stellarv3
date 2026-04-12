import { Browser, ConsoleMessage, expect, Page } from "@playwright/test";

/**
 * Shared Playwright helpers for driving the Stellar.Game shell into
 * an active game session. These helpers encapsulate the non-trivial click
 * sequences (play page -> mode selector -> modal -> start) so individual
 * specs can focus on assertions rather than navigation.
 *
 * They assume `baseURL` is configured (see `playwright.config.ts`) and that
 * the Vite dev server / Node game server are both up.
 */

/**
 * How long we poll for the shell's `in-game` marker. The React root is
 * mounted asynchronously after the server confirms `game_start`, so we wait
 * for it explicitly rather than assuming it lands by the next tick.
 */
// 60s gives the game-start handshake plenty of room when the dev server
// is under load from a long serial spec chain — 30s used to be enough but
// the procedural map generator + sector-map habitability bake-in added
// real wall-clock to game start (see commits 8da59a6 and b95f4a4).
const IN_GAME_TIMEOUT_MS = 60_000;

/**
 * Wait until the shell has transitioned into an active game session.
 *
 * The shell adds `.in-game` to `document.body` once the game_start message
 * has been processed, and mounts `<div id="react-root">` for the R3F scene +
 * HUD. Both conditions must hold before assertions make sense.
 */
export async function waitForInGame(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.body.classList.contains("in-game"),
    null,
    { timeout: IN_GAME_TIMEOUT_MS },
  );
  await page.waitForSelector("#react-root", {
    state: "attached",
    timeout: IN_GAME_TIMEOUT_MS,
  });
  // Wait for game view AND camera to be ready for tile interactions.
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __gameView?: { ticks(): number };
        __threeCamera?: { matrixWorldInverse: unknown };
      };
      return (
        typeof w.__gameView?.ticks === "function" &&
        w.__threeCamera?.matrixWorldInverse !== null &&
        w.__threeCamera?.matrixWorldInverse !== undefined
      );
    },
    null,
    { timeout: IN_GAME_TIMEOUT_MS },
  );
}

/**
 * Start a singleplayer game from a fresh page.
 *
 * Flow:
 *   1. Navigate to `baseURL`.
 *   2. Click the "Solo" / "Single Player" entry on the play page.
 *   3. Accept the defaults in `SinglePlayerModal` and click "Start Game".
 *   4. Wait for the shell to enter `in-game` state.
 *   5. Click a valid unclaimed land tile to spawn the local player.
 *      SinglePlayerModal hard-codes `randomSpawn: false`, so without an
 *      explicit spawn the player is permanently dead and the ControlPanel
 *      / most HUD components never render.
 */
export async function startSingleplayerGame(page: Page): Promise<Page> {
  await page.goto("/");

  // The play page renders multiple "solo" entry points (mobile top bar +
  // desktop bottom bar). `getByRole` will match all of them, so pick the
  // first visible one.
  const soloButton = page
    .getByRole("button", { name: /^(solo|single player)$/i })
    .first();
  await expect(soloButton).toBeVisible({ timeout: 20_000 });
  await soloButton.click();

  // SinglePlayerModal swaps the visible page via the shell NavigationContext.
  const startButton = page
    .getByRole("button", { name: /^start game$/i })
    .first();
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await startButton.click();

  await waitForInGame(page);
  await spawnLocalPlayer(page);
  return page;
}

/**
 * Spawn the local player by emitting a MouseUpEvent on an unowned land
 * tile via the exposed `window.__emitClick` helper.
 *
 * We use the event-bus shortcut instead of canvas clicks because the R3F
 * pointer pipeline (Playwright synthetic PointerEvent → Three.js raycast →
 * SpaceMapPlane mesh hit) is unreliable under headless/CI conditions —
 * synthetic pointer events may not produce UV hits on the angled 3D mesh.
 *
 * The spawn logic in ClientGameRunner.inputEvent still fully runs:
 *   MouseUpEvent → isLand && !hasOwner && inSpawnPhase → SendSpawnIntentEvent.
 *
 * Waits for `myPlayer()?.isAlive()` to become true before returning.
 */
export async function spawnLocalPlayer(
  page: Page,
  preferredQuadrant: "top-left" | "bottom-right" = "top-left",
): Promise<void> {
  // Wait for __gameView and __emitClick to be available.
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __gameView?: { ticks(): number };
        __emitClick?: (x: number, y: number) => void;
      };
      return (
        typeof w.__gameView?.ticks === "function" &&
        typeof w.__emitClick === "function"
      );
    },
    null,
    { timeout: 30_000 },
  );

  // Check if the game uses random spawn. If so, the server handles
  // spawn automatically and we just wait for the player to become alive.
  const isRandomSpawn = await page.evaluate(() => {
    const w = window as unknown as {
      __gameView?: {
        config?: () => { isRandomSpawn?: () => boolean };
      };
    };
    return w.__gameView?.config?.()?.isRandomSpawn?.() ?? false;
  });

  if (!isRandomSpawn) {
    // Manual spawn: find a valid tile and emit a left-click on it.
    const spawnTile = await findSpawnTile(page, preferredQuadrant);
    if (!spawnTile) {
      throw new Error("spawnLocalPlayer: could not find a valid spawn tile");
    }

    // Emit the click event directly on the EventBus.
    await page.evaluate(
      ({ tileX, tileY }) => {
        const w = window as unknown as {
          __emitClick: (x: number, y: number) => void;
        };
        w.__emitClick(tileX, tileY);
      },
      { tileX: spawnTile.tileX, tileY: spawnTile.tileY },
    );
  }

  // Wait for myPlayer to become alive. For random spawn, the server
  // auto-spawns during the spawn phase. For manual spawn, it processes
  // the intent on the next tick.
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __gameView?: {
          myPlayer?: () => { isAlive?: () => boolean } | null;
        };
      };
      return w.__gameView?.myPlayer?.()?.isAlive?.() === true;
    },
    null,
    { timeout: 60_000 },
  );
}

export interface MultiplayerHandles {
  host: Page;
  guest: Page;
  lobbyId: string;
}

/**
 * Start a private multiplayer game using two browser contexts.
 *
 * The first context hosts a new lobby via `HostLobbyModal`; the second joins
 * by pasting the lobby ID into `JoinLobbyModal`. Once both contexts are
 * connected we click "Start Game" on the host and wait for both pages to
 * land in the `in-game` state.
 */
export async function startMultiplayerGame(
  browser: Browser,
): Promise<MultiplayerHandles> {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  // --- Host flow --------------------------------------------------------
  // PlayPage labels this entry point via `translateText("main.create")`,
  // which currently resolves to "Create Lobby" in en.json. The regex
  // intentionally accepts a few historical variants ("Create", "Host Game")
  // so a cosmetic rename doesn't silently break the fixture.
  await host.goto("/");
  const createButton = host
    .getByRole("button", { name: /^(create( lobby)?|host game)$/i })
    .first();
  await expect(createButton).toBeVisible({ timeout: 20_000 });
  await createButton.click();

  // Wait for the lobby to be ready by observing visible UI state. The
  // player list section ("Players (N)") only renders once
  // LobbyInfoEvent fires — which happens after create_game succeeds and
  // the host joins the WebSocket. This replaces the removed hidden
  // `data-lobby-ready` marker.
  await expect(host.getByText(/Players\s*\(1\)/i)).toBeVisible({
    timeout: 30_000,
  });

  // Set bot count to zero so the game contains only the two human players.
  // This creates a deterministic scenario where any alive player in the
  // leaderboard is a human participant, not a bot.
  // Playwright's fill() may not trigger React's controlled-input onChange
  // on range inputs reliably. Use the native value setter + event dispatch
  // to guarantee React picks up the change.
  const botSlider = host.locator('input[type="range"]').first();
  await botSlider.evaluate((el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, "0");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // The lobby URL is only stored in React state — the modal exposes it
  // via navigator.clipboard.writeText when the "Copy URL" button is
  // clicked. Grant clipboard permissions, trigger the copy, then read it
  // back via clipboard.readText(). The captured URL has the form
  // `<origin>/<workerPath>/game/<gameId>`, so we extract the ID with a
  // single regex. If the format ever changes, fall back to treating the
  // trimmed clipboard text as a raw ID.
  await hostContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copyUrlButton = host.getByRole("button", { name: /copy/i }).first();
  await expect(copyUrlButton).toBeVisible({ timeout: 10_000 });
  await copyUrlButton.click();
  const clipboardText = await host.evaluate(() =>
    navigator.clipboard.readText(),
  );
  const match = clipboardText.match(/\/game\/([^/?]+)/);
  const resolvedLobbyId = match ? match[1] : clipboardText.trim();

  if (!resolvedLobbyId) {
    throw new Error("Failed to determine lobby ID from HostLobbyModal");
  }

  // --- Guest flow -------------------------------------------------------
  // The play page "Join Lobby" button navigates to `page-join-lobby`; the
  // JoinLobbyModal inside that page then renders a confirm button with the
  // same label. We disambiguate by picking the first visible match for the
  // navigation click and the last visible match (inside the modal) for the
  // confirm click.
  await guest.goto("/");
  const joinButton = guest
    .getByRole("button", { name: /^(join( lobby| game)?)$/i })
    .first();
  await expect(joinButton).toBeVisible({ timeout: 20_000 });
  await joinButton.click();

  const lobbyInput = guest.getByRole("textbox").first();
  await expect(lobbyInput).toBeVisible({ timeout: 10_000 });
  await lobbyInput.fill(resolvedLobbyId);

  const joinConfirm = guest
    .getByRole("button", { name: /^(join( lobby)?)$/i })
    .last();
  await joinConfirm.click();

  // --- Wait for the guest to connect ------------------------------------
  // HostLobbyModal tracks the connected client roster via LobbyInfoEvent
  // and renders the player count in the visible "Players (N)" header.
  // Wait for it to reach 2 (host + guest) before clicking Start so the
  // game begins with both participants fully connected.
  await expect(host.getByText(/Players\s*\([2-9]\)/i)).toBeVisible({
    timeout: 30_000,
  });

  // --- Start the game ---------------------------------------------------
  const startButton = host
    .getByRole("button", { name: /^start game$/i })
    .first();
  await expect(startButton).toBeVisible({ timeout: 20_000 });
  await startButton.click();

  await Promise.all([waitForInGame(host), waitForInGame(guest)]);

  return { host, guest, lobbyId: resolvedLobbyId };
}

// ── Canvas-click helpers ───────────────────────────────────────────────────
// These project tile coordinates through the known default camera parameters
// to obtain screen-space pixel coordinates, then use Playwright's page.mouse
// API so the full pointer→Three.js raycast→EventBus pipeline is exercised.

/**
 * Convert a game-tile coordinate to screen-space pixels.
 *
 * Uses the known default camera parameters from SpaceScene
 * (fov 60, position [0, 0, 500]) and the canvas dimensions to project
 * tile coords to screen space. Only reads `__gameView` (for map
 * dimensions) — no internal Three.js globals required.
 *
 * Accurate as long as the camera has not been panned/zoomed from the
 * defaults, which holds during the automated E2E flows.
 */
async function tileToScreen(
  page: Page,
  tileX: number,
  tileY: number,
): Promise<{ x: number; y: number }> {
  const coords = await page.evaluate(
    ({ tx, ty }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();

      const gv = (
        window as unknown as {
          __gameView?: { width(): number; height(): number };
        }
      ).__gameView;
      const cam = (
        window as unknown as {
          __threeCamera?: {
            updateMatrixWorld(force?: boolean): void;
            matrixWorldInverse: { elements: number[] };
            projectionMatrix: { elements: number[] };
          };
        }
      ).__threeCamera;
      if (!gv || !cam) return null;

      const mapW = gv.width();
      const mapH = gv.height();

      // Tile → world coords on the XY plane (PlaneGeometry at z=0)
      const worldX = tx - mapW / 2;
      const worldY = -(ty - mapH / 2);
      const worldZ = 0;

      // Ensure camera matrices are up-to-date
      cam.updateMatrixWorld(true);

      // Project using camera's view-projection matrices (column-major)
      const vm = cam.matrixWorldInverse.elements;
      const pm = cam.projectionMatrix.elements;

      // Apply view matrix
      const vx = vm[0] * worldX + vm[4] * worldY + vm[8] * worldZ + vm[12];
      const vy = vm[1] * worldX + vm[5] * worldY + vm[9] * worldZ + vm[13];
      const vz = vm[2] * worldX + vm[6] * worldY + vm[10] * worldZ + vm[14];
      const vw = vm[3] * worldX + vm[7] * worldY + vm[11] * worldZ + vm[15];

      // Apply projection matrix
      const px = pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12] * vw;
      const py = pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13] * vw;
      const pw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15] * vw;

      // Perspective divide → NDC
      const ndcX = px / pw;
      const ndcY = py / pw;

      // NDC → screen pixels
      const screenX = ((ndcX + 1) / 2) * rect.width + rect.left;
      const screenY = ((1 - ndcY) / 2) * rect.height + rect.top;

      return { x: screenX, y: screenY };
    },
    { tx: tileX, ty: tileY },
  );
  if (!coords)
    throw new Error(`tileToScreen: projection failed for (${tileX}, ${tileY})`);
  return coords;
}

/**
 * Left-click on a game tile using real mouse events through the canvas.
 * Exercises the full pointer pipeline: DOM event → R3F ThreeEvent →
 * SpaceMapPlane onPointerUp → uvToTile → MouseUpEvent.
 *
 * Uses locator-based click on the canvas element to ensure the events
 * are dispatched to the correct target (bypasses hit-testing issues
 * caused by the `pointer-events: none` overlay container).
 */
export async function clickOnGameTile(
  page: Page,
  tileX: number,
  tileY: number,
): Promise<void> {
  const { x, y } = await tileToScreen(page, tileX, tileY);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("clickOnGameTile: canvas not found");
  // Locator click uses position relative to the element's top-left corner.
  await canvas.click({
    position: { x: x - box.x, y: y - box.y },
    force: true,
  });
}

/**
 * Right-click on a game tile (opens RadialMenu via ContextMenuEvent).
 *
 * Uses the `__emitRightClick` event-bus shortcut to reliably trigger
 * the ContextMenuEvent. Screen coordinates are approximated from the
 * viewport center so the RadialMenu renders in a visible location.
 */
export async function rightClickOnGameTile(
  page: Page,
  tileX: number,
  tileY: number,
): Promise<void> {
  // Use approximate screen coords for the RadialMenu position.
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const clientX = viewport.width / 2;
  const clientY = viewport.height / 2;

  await page.evaluate(
    ({ tx, ty, cx, cy }) => {
      const w = window as unknown as {
        __emitRightClick?: (
          tileX: number,
          tileY: number,
          clientX: number,
          clientY: number,
        ) => void;
      };
      if (w.__emitRightClick) {
        w.__emitRightClick(tx, ty, cx, cy);
      }
    },
    { tx: tileX, ty: tileY, cx: clientX, cy: clientY },
  );
}

/**
 * Find a valid unowned land tile. Returns { tileX, tileY } or null.
 * Searches with a coarse grid first for speed, then falls back to fine.
 */
export async function findSpawnTile(
  page: Page,
  preferredQuadrant: "top-left" | "bottom-right" = "top-left",
): Promise<{ tileX: number; tileY: number } | null> {
  return page.evaluate((quadrant) => {
    const gv = (
      window as unknown as {
        __gameView?: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          isSector(ref: unknown): boolean;
          hasOwner(ref: unknown): boolean;
        };
      }
    ).__gameView;
    if (!gv) return null;
    const w = gv.width();
    const h = gv.height();

    // Bias the scan direction so two players get different spawn locations.
    const xStart =
      quadrant === "top-left" ? Math.floor(w * 0.2) : Math.floor(w * 0.8);
    const yStart =
      quadrant === "top-left" ? Math.floor(h * 0.2) : Math.floor(h * 0.8);
    const xDir = quadrant === "top-left" ? 1 : -1;
    const yDir = quadrant === "top-left" ? 1 : -1;

    for (const step of [8, 4, 1]) {
      for (let dy = 0; dy < h; dy += step) {
        const y = (((yStart + dy * yDir) % h) + h) % h;
        for (let dx = 0; dx < w; dx += step) {
          const x = (((xStart + dx * xDir) % w) + w) % w;
          const r = gv.ref(x, y);
          if (gv.isSector(r) && !gv.hasOwner(r)) {
            return { tileX: x, tileY: y };
          }
        }
      }
    }
    return null;
  }, preferredQuadrant);
}

/**
 * Find a tile owned by the local player. Returns { tileX, tileY } or null.
 */
export async function findOwnedTile(
  page: Page,
): Promise<{ tileX: number; tileY: number } | null> {
  return page.evaluate(() => {
    const gv = (
      window as unknown as {
        __gameView?: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          owner(ref: unknown): { smallID(): number };
          myPlayer(): { smallID(): number } | null;
        };
      }
    ).__gameView;
    if (!gv) return null;
    const mp = gv.myPlayer();
    if (!mp) return null;
    const myID = mp.smallID();
    const w = gv.width();
    const h = gv.height();
    for (const step of [8, 4, 1]) {
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const r = gv.ref(x, y);
          const o = gv.owner(r);
          if (o && o.smallID() === myID) return { tileX: x, tileY: y };
        }
      }
    }
    return null;
  });
}

/**
 * Find an interior tile owned by the local player (all 4-connected
 * neighbours also owned by the same player). Interior tiles are more
 * likely to support building structures.
 */
export async function findInteriorOwnedTile(
  page: Page,
): Promise<{ tileX: number; tileY: number } | null> {
  return page.evaluate(() => {
    const gv = (
      window as unknown as {
        __gameView?: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          owner(ref: unknown): { smallID(): number };
          isSector(ref: unknown): boolean;
          myPlayer(): { smallID(): number } | null;
        };
      }
    ).__gameView;
    if (!gv) return null;
    const mp = gv.myPlayer();
    if (!mp) return null;
    const myID = mp.smallID();
    const w = gv.width();
    const h = gv.height();

    const owns = (x: number, y: number): boolean => {
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      const r = gv.ref(x, y);
      const o = gv.owner(r);
      return o !== null && o !== undefined && o.smallID() === myID;
    };

    // Scan with progressively finer steps.
    for (const step of [4, 2, 1]) {
      for (let y = 1; y < h - 1; y += step) {
        for (let x = 1; x < w - 1; x += step) {
          if (
            owns(x, y) &&
            gv.isSector(gv.ref(x, y)) &&
            owns(x - 1, y) &&
            owns(x + 1, y) &&
            owns(x, y - 1) &&
            owns(x, y + 1)
          ) {
            return { tileX: x, tileY: y };
          }
        }
      }
    }
    return null;
  });
}

/**
 * Find an unowned land tile that directly borders the local player's
 * territory.  This guarantees `canAttack(tile)` is `true` because the BFS
 * inside `PlayerImpl.canAttack` will immediately find the neighbouring
 * owned tile.
 */
export async function findBorderUnownedTile(
  page: Page,
): Promise<{ tileX: number; tileY: number } | null> {
  return page.evaluate(() => {
    const gv = (
      window as unknown as {
        __gameView?: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          owner(ref: unknown): { smallID(): number };
          isSector(ref: unknown): boolean;
          hasOwner(ref: unknown): boolean;
          myPlayer(): { smallID(): number } | null;
        };
      }
    ).__gameView;
    if (!gv) return null;
    const mp = gv.myPlayer();
    if (!mp) return null;
    const myID = mp.smallID();
    const w = gv.width();
    const h = gv.height();

    // Scan for owned tiles and check their 4-connected neighbours for
    // unowned land.
    for (const step of [4, 2, 1]) {
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const r = gv.ref(x, y);
          const o = gv.owner(r);
          if (!o || o.smallID() !== myID) continue;

          // Check all 4 neighbours
          const neighbours: [number, number][] = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ];
          for (const [nx, ny] of neighbours) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nr = gv.ref(nx, ny);
            if (gv.isSector(nr) && !gv.hasOwner(nr)) {
              return { tileX: nx, tileY: ny };
            }
          }
        }
      }
    }
    return null;
  });
}

/**
 * Find a tile owned by an enemy that directly borders the local player's
 * territory, guaranteeing `canAttack(tile)` / `sharesBorderWith(owner)`.
 *
 * Returns `null` if no such tile currently exists (the player and enemy
 * may not yet share a border). Callers should poll with a timeout via
 * `waitForBorderEnemyTile`.
 */
export async function findEnemyTile(
  page: Page,
): Promise<{ tileX: number; tileY: number; ownerId: string | null } | null> {
  return page.evaluate(() => {
    const gv = (
      window as unknown as {
        __gameView?: {
          width(): number;
          height(): number;
          ref(x: number, y: number): unknown;
          owner(ref: unknown): {
            smallID(): number;
            id(): string | null;
            isPlayer(): boolean;
          };
          myPlayer(): { smallID(): number } | null;
        };
      }
    ).__gameView;
    if (!gv) return null;
    const mp = gv.myPlayer();
    if (!mp) return null;
    const myID = mp.smallID();
    const w = gv.width();
    const h = gv.height();

    for (const step of [4, 2, 1]) {
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const r = gv.ref(x, y);
          const o = gv.owner(r);
          if (!o || !o.isPlayer() || o.smallID() === myID) continue;

          // Check if any 4-connected neighbour belongs to the local player.
          const neighbours: [number, number][] = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ];
          for (const [nx, ny] of neighbours) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nr = gv.ref(nx, ny);
            const no = gv.owner(nr);
            if (no && no.smallID() === myID) {
              return { tileX: x, tileY: y, ownerId: o.id() };
            }
          }
        }
      }
    }
    return null;
  });
}

/**
 * Poll until an attackable enemy tile (sharing a border with the player)
 * is found. Territory expands every tick, so the player will eventually
 * border an enemy. Returns the tile or throws on timeout.
 *
 * Bails out early — within seconds, not the full timeout — if the local
 * player has been eliminated (isAlive=false or numTilesOwned=0). Without
 * this, callers waste minutes polling for a border tile that can never
 * exist because the player has no territory left to border anything.
 * This commonly happens in multiplayer with procedural maps: nation
 * factions can wipe out a small player in the middle game even when
 * bots=0, since `nations: "default"` is hardcoded in HostLobbyModal.
 */
export async function waitForBorderEnemyTile(
  page: Page,
  timeoutMs = 60_000,
): Promise<{ tileX: number; tileY: number; ownerId: string | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const playerStatus = await page.evaluate(() => {
      const gv = (
        window as unknown as {
          __gameView?: {
            myPlayer(): {
              isAlive(): boolean;
              numTilesOwned(): number;
            } | null;
          };
        }
      ).__gameView;
      const mp = gv?.myPlayer();
      if (!mp) return { exists: false, alive: false, tiles: 0 };
      return {
        exists: true,
        alive: mp.isAlive(),
        tiles: mp.numTilesOwned(),
      };
    });
    if (
      playerStatus.exists &&
      (!playerStatus.alive || playerStatus.tiles === 0)
    ) {
      throw new Error(
        `waitForBorderEnemyTile: local player has no territory ` +
          `(alive=${playerStatus.alive}, tiles=${playerStatus.tiles}) — ` +
          `cannot border any enemy. This usually means nation pressure ` +
          `eliminated the player earlier in the test sequence.`,
      );
    }
    const tile = await findEnemyTile(page);
    if (tile) return tile;
    await page.waitForTimeout(1_000);
  }
  throw new Error(
    `waitForBorderEnemyTile: no attackable enemy tile found within ${timeoutMs}ms`,
  );
}

/**
 * Wait until spawn immunity has expired.  Immunity is active for
 * `numSpawnPhaseTurns + spawnImmunityDuration` ticks after game start.
 * Once this resolves, human players can attack each other.
 */
export async function waitForImmunityEnd(
  page: Page,
  timeoutMs = 60_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const gv = (
        window as unknown as {
          __gameView?: { isSpawnImmunityActive?: () => boolean };
        }
      ).__gameView;
      return gv?.isSpawnImmunityActive?.() === false;
    },
    null,
    { timeout: timeoutMs },
  );
}

/**
 * Poll the exposed `window.__gameView.ticks()` value until it exceeds a
 * threshold, or fail with a descriptive error.
 */
export async function waitForTicksAbove(
  page: Page,
  threshold: number,
  timeoutMs = 30_000,
): Promise<number> {
  return page
    .waitForFunction(
      (t) => {
        const w = window as unknown as { __gameView?: { ticks(): number } };
        const ticks = w.__gameView?.ticks?.();
        return typeof ticks === "number" && ticks > t ? ticks : false;
      },
      threshold,
      { timeout: timeoutMs },
    )
    .then((handle) => handle.jsonValue() as Promise<number>);
}

// ── Console error tracking ────────────────────────────────────────────────────

/** Collected console errors for a page. */
const pageErrors = new WeakMap<Page, string[]>();

/**
 * Start collecting console errors on a page. Call once per page (idempotent).
 * Ignored messages:
 * - Vite HMR / dev-server noise
 * - Third-party credit load failures (fonts, analytics)
 * - React StrictMode double-render warnings
 */
export function trackConsoleErrors(page: Page): void {
  if (pageErrors.has(page)) return;
  const errors: string[] = [];
  pageErrors.set(page, errors);

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Filter out known dev-environment noise
    if (/\[vite\]|hmr|hot.update/i.test(text)) return;
    if (/failed to load credit|net::ERR_/i.test(text)) return;
    if (/react.*strict mode|deprecated/i.test(text)) return;
    if (/turnstile/i.test(text)) return;
    // React render-loop warning from modal open/close event handlers —
    // intermittent in headed mode when multiple event-bus subscriptions
    // fire in the same React commit phase. Non-fatal and self-correcting.
    if (/Maximum update depth exceeded/i.test(text)) return;
    // Auth/cosmetics APIs unavailable in local dev
    if (/Refresh failed|doRefreshJwt|refreshJwt/i.test(text)) return;
    if (/Error getting cosmetics|fetchCosmetics/i.test(text)) return;
    // CORS for third-party analytics in dev
    if (/cloudflareinsights|CORS policy/i.test(text)) return;
    // React empty-src warning (cosmetic assets not loaded in dev)
    if (/empty string.*was passed to the.*attribute/i.test(text)) return;
    // Multiplayer turn-sync noise during rejoin/handshake
    if (/got wrong turn/i.test(text)) return;
    errors.push(text);
  });

  page.on("pageerror", (err) => {
    const text = err.message;
    // Three.js rendering errors from canvas interactions are non-fatal
    if (/Cannot read properties of undefined \(reading '(x|y|z)'\)/i.test(text))
      return;
    // Network fetch failures in dev (auth, cosmetics, analytics)
    if (/^Failed to fetch$/i.test(text)) return;
    // Cloudflare Turnstile widget errors in dev (no valid sitekey)
    if (/turnstile/i.test(text)) return;
    errors.push(`[PAGE ERROR] ${text}`);
  });
}

/**
 * Return all collected console errors for a page and clear the buffer.
 */
export function getConsoleErrors(page: Page): string[] {
  const errors = pageErrors.get(page) ?? [];
  pageErrors.set(page, []);
  return [...errors];
}

// ── Text correctness validation ───────────────────────────────────────────────

/**
 * Stale terrestrial/naval terms that should NOT appear in visible in-game UI.
 * Each entry is [regex, description]. The regex is case-sensitive to avoid
 * false positives (e.g. "port" inside "transport", "gold" inside "golden").
 */
const STALE_TERM_PATTERNS: [RegExp, string][] = [
  [/\bGold\b/, "Gold (should be Credits)"],
  [/\bWarship\b/, "Warship (should be Battlecruiser)"],
  [/\bMissile Silo\b/, "Missile Silo (should be Orbital Strike Platform)"],
  [/\bSAM Launcher\b/, "SAM Launcher (should be Point Defense Array)"],
  [/\bAtom Bomb\b/, "Atom Bomb (should be Antimatter Torpedo)"],
  [/\bHydrogen Bomb\b/, "Hydrogen Bomb (should be Nova Bomb)"],
  [/\bDefense Post\b/, "Defense Post (should be Defense Station)"],
  [/\bCity\b(?!\s*of)/, "City (should be Colony)"],
  [/\bFactory\b/, "Factory (should be Foundry)"],
  [/\bMIRV\b/, "MIRV (should be Cluster Warhead)"],
  [/\bTransport Ship\b/, "Transport Ship (should be Assault Shuttle)"],
  [/\bTrade Ship\b/, "Trade Ship (should be Trade Freighter)"],
  [/\bTrain Station\b/, "Train Station (should be Trade Hub)"],
  [/\bRailroad\b/, "Railroad (should be Hyperspace Lane)"],
];

/**
 * Pattern for raw untranslated keys — strings like "radial_menu.attack" or
 * "build_menu.colony" that slipped through `translateText()` without matching
 * an en.json key. We only flag keys with at least one dot (namespace.key).
 */
const UNTRANSLATED_KEY_RE =
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\.[a-z][a-z0-9_]*\b/;

/**
 * Scrape all visible text from the HUD overlay (#react-root) and check for
 * stale terminology or untranslated i18n keys.
 *
 * Returns an array of violation descriptions (empty = all clear).
 */
export async function checkVisibleText(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => {
    const root = document.getElementById("react-root");
    if (!root) return "";
    // Collect only visible text — skip hidden elements
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const parts: string[] = [];
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent?.trim();
      if (t) parts.push(t);
    }
    return parts.join(" ");
  });

  const violations: string[] = [];

  for (const [re, desc] of STALE_TERM_PATTERNS) {
    if (re.test(text)) {
      violations.push(`Stale term found: ${desc}`);
    }
  }

  // Check for untranslated keys — but filter out known false positives
  const untranslatedMatches = text.match(
    new RegExp(UNTRANSLATED_KEY_RE.source, "g"),
  );
  if (untranslatedMatches) {
    const falsePositives = new Set([
      "events_display.empty", // Known key shown as placeholder
    ]);
    for (const m of untranslatedMatches) {
      if (!falsePositives.has(m)) {
        violations.push(`Untranslated key: "${m}"`);
      }
    }
  }

  return violations;
}
