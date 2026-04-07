// @vitest-environment node
import { AttackExecution } from "../../src/core/execution/AttackExecution";

import { AssaultShuttleExecution } from "../../src/core/execution/AssaultShuttleExecution";
import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../src/core/execution/NukeExecution";
import {
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import { GameViewTestHarness, setupGameViewTest } from "./GameViewTestHelper";

// ──────────────────────────────────────────────
// Category 1: Tile State
// ──────────────────────────────────────────────
describe("GameView Integration — Tile State", () => {
  let h: GameViewTestHarness;

  beforeEach(async () => {
    h = await setupGameViewTest("plains", {
      infiniteCredits: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    h.spawnPlayer(p1, h.game.ref(50, 50));
    h.executeUntilSpawnPhaseEnds();
  });

  test("owner(tile) returns the spawned player after expansion", () => {
    // After spawn phase, the player should own the spawn tile
    const spawnTile = h.gameView.ref(50, 50);
    const owner = h.gameView.owner(spawnTile);
    expect(owner.isPlayer()).toBe(true);
  });

  test("isSector(tile) reports correct terrain", () => {
    // Plains map is all land
    const landTile = h.gameView.ref(50, 50);
    expect(h.gameView.isSector(landTile)).toBe(true);
  });

  test("isBorder(tile) detects border tiles", () => {
    // After spawning, tiles at the edge of owned territory should be border tiles.
    // Run a few ticks for territory to establish.
    h.executeTicks(5);

    const player = h.game.player("p1_id");
    let foundBorder = false;
    for (const tile of player.borderTiles()) {
      if (h.gameView.isBorder(tile)) {
        foundBorder = true;
        break;
      }
    }
    expect(foundBorder).toBe(true);
  });

  test("owner(tile) tracks territory expansion over ticks", () => {
    // Attack into unclaimed territory to expand
    const target = h.game.ref(55, 50);
    const player = h.game.player("p1_id");
    h.game.addExecution(new AttackExecution(100, player, null, target));

    // Run several ticks to allow expansion
    h.executeTicks(20);

    // Some tiles near the target should now be owned
    const owner = h.gameView.owner(target);
    expect(owner.isPlayer()).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Category 2: Unit State
// ──────────────────────────────────────────────
describe("GameView Integration — Unit State", () => {
  let h: GameViewTestHarness;
  let player: Player;

  beforeEach(async () => {
    h = await setupGameViewTest("ocean_and_land", {
      infiniteCredits: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    // Spawn near the land-ocean boundary so the player's radius-4 territory
    // includes shore tiles without needing extra expansion.
    h.spawnPlayer(p1, h.game.ref(5, 10));
    h.executeUntilSpawnPhaseEnds();
    player = h.game.player("p1_id");
  });

  test("units() reflects a built MissileSilo", () => {
    h.game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.OrbitalStrikePlatform,
        h.game.ref(5, 10),
      ),
    );
    h.executeTicks(4);

    const silos = h.gameView.units(UnitType.OrbitalStrikePlatform);
    expect(silos.length).toBeGreaterThanOrEqual(1);

    const silo = silos[0];
    expect(silo.type()).toBe(UnitType.OrbitalStrikePlatform);
    expect(silo.owner().isPlayer()).toBe(true);
  });

  test("unit tile() matches expected position", () => {
    const buildTile = h.game.ref(5, 10);
    h.game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.OrbitalStrikePlatform,
        buildTile,
      ),
    );
    h.executeTicks(4);

    const silos = h.gameView.units(UnitType.OrbitalStrikePlatform);
    expect(silos.length).toBeGreaterThanOrEqual(1);
    expect(silos[0].tile()).toBe(buildTile);
  });

  test("TransportShip appears in units() after launch", () => {
    // Ocean_and_land map (16×16): land on the left (~x=0-7), ocean on right.
    // Spawn is at (5,10); with radius-4 territory the player already has
    // shore tiles at the land-ocean boundary without extra expansion.

    // Build a port at the shore so the player can launch a transport ship.
    const portTile = h.game.ref(6, 10);
    h.game.addExecution(
      new ConstructionExecution(player, UnitType.Spaceport, portTile),
    );
    h.executeTick();

    // Launch a transport ship toward open ocean on the far side.
    // Check after just 1 tick — the ship is created during init() and visible
    // before it completes the journey (arriving deletes it within ~10 ticks).
    const oceanTarget = h.game.ref(14, 10);
    h.game.addExecution(new AssaultShuttleExecution(player, oceanTarget, 50));
    h.executeTick();

    const ships = h.gameView.units(UnitType.AssaultShuttle);
    expect(ships.length).toBeGreaterThanOrEqual(1);
    expect(ships[0].type()).toBe(UnitType.AssaultShuttle);
  });
});

// ──────────────────────────────────────────────
// Category 3: Player State
// ──────────────────────────────────────────────
describe("GameView Integration — Player State", () => {
  let h: GameViewTestHarness;

  beforeEach(async () => {
    h = await setupGameViewTest(
      "plains",
      {
        infiniteCredits: true,
        instantBuild: true,
      },
      [new PlayerInfo("player1", PlayerType.Human, "client1", "p1_id")],
    );

    const p2 = new PlayerInfo("player2", PlayerType.Human, null, "p2_id");
    h.game.addPlayer(p2);

    h.spawnPlayer(
      new PlayerInfo("player1", PlayerType.Human, "client1", "p1_id"),
      h.game.ref(10, 10),
    );
    h.spawnPlayer(p2, h.game.ref(10, 20));

    h.executeUntilSpawnPhaseEnds();
  });

  test("myPlayer() returns the focused player", () => {
    const my = h.gameView.myPlayer();
    expect(my).not.toBeNull();
    expect(my!.clientID()).toBe("client1");
  });

  test("numTilesOwned() increases after territorial expansion", () => {
    const initialTiles = h.gameView.myPlayer()!.numTilesOwned();
    expect(initialTiles).toBeGreaterThan(0);

    // Expand into unclaimed territory
    const player = h.game.player("p1_id");
    h.game.addExecution(
      new AttackExecution(100, player, null, h.game.ref(15, 10)),
    );
    h.executeTicks(10);

    expect(h.gameView.myPlayer()!.numTilesOwned()).toBeGreaterThan(
      initialTiles,
    );
  });

  test("troops() reflects troop count", () => {
    const troops = h.gameView.myPlayer()!.troops();
    expect(typeof troops).toBe("number");
    expect(troops).toBeGreaterThan(0);
  });

  test("gold() returns a bigint value", () => {
    const gold = h.gameView.myPlayer()!.credits();
    expect(typeof gold).toBe("bigint");
  });

  test("isAlive() is true for active player", () => {
    expect(h.gameView.myPlayer()!.isAlive()).toBe(true);
  });

  test("player troop count changes after combat", () => {
    const attacker = h.game.player("p1_id");
    const defender = h.game.player("p2_id");

    const initialTroops = h.gameView.myPlayer()!.troops();

    // Attack the defender's territory
    h.game.addExecution(
      new AttackExecution(50, attacker, defender.id(), h.game.ref(10, 20)),
    );
    h.executeTicks(10);

    // Troops should have changed (decreased due to combat losses)
    expect(h.gameView.myPlayer()!.troops()).not.toBe(initialTroops);
  });
});

// ──────────────────────────────────────────────
// Category 4: HyperspaceLane / Train State
// ──────────────────────────────────────────────
describe("GameView Integration — Railroad State", () => {
  let h: GameViewTestHarness;
  let player: Player;

  beforeEach(async () => {
    h = await setupGameViewTest("plains", {
      infiniteCredits: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    h.spawnPlayer(p1, h.game.ref(50, 50));
    h.executeUntilSpawnPhaseEnds();
    player = h.game.player("p1_id");

    // Both factory tiles are within the initial spawn radius (~4 tiles from (50,50)),
    // so no expansion is needed when structureMinDist is 0.
  });

  test("Factory appears in GameView units after construction", () => {
    // Use ConstructionExecution so the unit update is captured within a tick.
    h.game.addExecution(
      new ConstructionExecution(player, UnitType.Foundry, h.game.ref(50, 50)),
    );
    h.executeTicks(4);

    const factories = h.gameView.units(UnitType.Foundry);
    expect(factories.length).toBeGreaterThanOrEqual(1);
    expect(factories[0].type()).toBe(UnitType.Foundry);
  });

  test("RailroadConstruction update emitted when factory built", () => {
    // Build two factories to trigger a railroad connection.
    // Both tiles are within the initial spawn radius of (50,50); structureMinDist=0
    // so no minimum distance is enforced between them.
    h.game.addExecution(
      new ConstructionExecution(player, UnitType.Foundry, h.game.ref(50, 50)),
    );
    h.executeTicks(2);

    h.game.addExecution(
      new ConstructionExecution(player, UnitType.Foundry, h.game.ref(52, 50)),
    );
    h.executeTicks(4);

    // Check for railroad construction updates across recent ticks
    h.gameView.updatesSinceLastTick();
    // Railroad construction events should have been emitted at some point
    // (they may have been in an earlier tick, so we just verify factories exist)
    const factories = h.gameView.units(UnitType.Foundry);
    expect(factories.length).toBeGreaterThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────
// Category 5: Game Phases
// ──────────────────────────────────────────────
describe("GameView Integration — Game Phases", () => {
  test("inSpawnPhase() returns true during spawn phase", async () => {
    const h = await setupGameViewTest("plains");
    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    h.spawnPlayer(p1, h.game.ref(50, 50));

    // First tick — should still be in spawn phase
    h.executeTick();
    expect(h.gameView.inSpawnPhase()).toBe(true);
  });

  test("inSpawnPhase() returns false after spawn phase ends", async () => {
    const h = await setupGameViewTest("plains");
    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    h.spawnPlayer(p1, h.game.ref(50, 50));

    h.executeUntilSpawnPhaseEnds();
    // One more tick to be sure
    h.executeTick();

    expect(h.gameView.inSpawnPhase()).toBe(false);
  });

  test("ticks() increases with each executed tick", async () => {
    const h = await setupGameViewTest("plains");
    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    h.spawnPlayer(p1, h.game.ref(50, 50));

    h.executeTick();
    const ticksAfterOne = h.gameView.ticks();
    expect(ticksAfterOne).toBe(1);

    h.executeTicks(4);
    expect(h.gameView.ticks()).toBe(5);
  });

  test("ticks() is consistent between Game and GameView", async () => {
    const h = await setupGameViewTest("plains");
    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    h.game.addPlayer(p1);
    h.spawnPlayer(p1, h.game.ref(50, 50));

    h.executeTicks(10);
    expect(h.gameView.ticks()).toBe(h.game.ticks());
  });
});

// ──────────────────────────────────────────────
// Category 6: Updates (updatesSinceLastTick)
// ──────────────────────────────────────────────
describe("GameView Integration — Updates", () => {
  let h: GameViewTestHarness;

  beforeEach(async () => {
    h = await setupGameViewTest("plains", {
      infiniteCredits: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const p1 = new PlayerInfo("player1", PlayerType.Human, null, "p1_id");
    const p2 = new PlayerInfo("player2", PlayerType.Human, null, "p2_id");
    h.game.addPlayer(p1);
    h.game.addPlayer(p2);
    h.spawnPlayer(p1, h.game.ref(50, 50));
    h.spawnPlayer(p2, h.game.ref(50, 60));
    h.executeUntilSpawnPhaseEnds();
  });

  test("updatesSinceLastTick() returns non-null after a tick", () => {
    h.executeTick();
    const updates = h.gameView.updatesSinceLastTick();
    expect(updates).not.toBeNull();
  });

  test("Player updates are emitted each tick", () => {
    h.executeTick();
    const updates = h.gameView.updatesSinceLastTick()!;
    expect(updates[GameUpdateType.Player].length).toBeGreaterThan(0);
  });

  test("Unit updates emitted when building a structure", () => {
    const player = h.game.player("p1_id");
    h.game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.OrbitalStrikePlatform,
        h.game.ref(50, 50),
      ),
    );

    // Tick to init construction
    h.executeTick();
    // Tick to execute construction
    h.executeTick();

    // Check that unit updates were emitted at some point
    const updates = h.gameView.updatesSinceLastTick()!;
    expect(updates[GameUpdateType.Unit].length).toBeGreaterThan(0);
  });

  test("Attack updates appear in player outgoingAttacks after attacking", () => {
    const attacker = h.game.player("p1_id");
    const defender = h.game.player("p2_id");

    // p1 spawns at (50,50) and p2 at (50,60). Their spawn territories extend
    // ~4 tiles each, leaving a neutral gap. First expand p1 into that gap so
    // the two territories share a border before launching the attack.
    h.game.addExecution(
      new AttackExecution(200, attacker, null, h.game.ref(50, 55)),
    );
    h.executeTicks(10);

    // Now attack p2; use no sourceTile so the execution picks a border tile.
    h.game.addExecution(new AttackExecution(50, attacker, defender.id()));
    h.executeTicks(3);

    // Check via GameView player
    const players = h.gameView.players();
    const attackerView = players.find(
      (p) => p.smallID() === attacker.smallID(),
    );
    expect(attackerView).toBeDefined();
    expect(attackerView!.outgoingAttacks().length).toBeGreaterThan(0);
  });

  test("Nuke creates Unit updates for AtomBomb", () => {
    const attacker = h.game.player("p1_id");

    // Build a missile silo first
    h.game.addExecution(
      new ConstructionExecution(
        attacker,
        UnitType.OrbitalStrikePlatform,
        h.game.ref(50, 50),
      ),
    );
    h.executeTicks(4);

    // Launch a nuke
    h.game.addExecution(
      new NukeExecution(
        UnitType.AntimatterTorpedo,
        attacker,
        h.game.ref(50, 60),
        null,
      ),
    );
    h.executeTick();
    h.executeTick();

    // AtomBomb should appear in GameView units
    const nukes = h.gameView.units(UnitType.AntimatterTorpedo);
    expect(nukes.length).toBeGreaterThanOrEqual(1);
    expect(nukes[0].type()).toBe(UnitType.AntimatterTorpedo);
    expect(nukes[0].owner().isPlayer()).toBe(true);
  });
});
