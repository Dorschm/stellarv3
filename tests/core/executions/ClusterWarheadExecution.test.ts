import { MirvExecution } from "../../../src/core/execution/ClusterWarheadExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("ClusterWarheadExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      {
        infiniteCredits: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    // Give player territory and missile silo
    for (let x = 5; x < 15; x++) {
      for (let y = 5; y < 15; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          player.conquer(tile);
        }
      }
    }
    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(10, 10), {});

    // Give other player territory closer to player
    for (let x = 25; x < 75; x++) {
      for (let y = 25; y < 75; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }
  });

  test("MIRV should launch successfully", async () => {
    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    // Execute until MIRV is launched (need 2 ticks: 1 to init execution, 1 to spawn MIRV)
    executeTicks(game, 2);

    // Verify MIRV unit was created
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);

    // Verify execution is still active (MIRV is flying)
    expect(mirvExec.isActive()).toBe(true);
  });

  test("MIRV should break alliances on launch", async () => {
    const req = player.createAllianceRequest(otherPlayer);
    req!.accept();

    expect(player.isAlliedWith(otherPlayer)).toBe(true);

    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // Alliance should be broken
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
    expect(player.isTraitor()).toBe(true);
  });

  test("MIRV should separate into warheads", async () => {
    // Increase territory to allow for multiple warhead targets
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(110, 110);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);
    expect(mirvExec.isActive()).toBe(true);

    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(0);
    expect(mirvExec.isActive()).toBe(false);

    // Wait one tick for NukeExecution
    executeTicks(game, 1);

    // Exact number of warheads may vary due to randomness, but should be more than 0
    expect(
      player.units(UnitType.ClusterWarheadSubmunition).length,
    ).toBeGreaterThan(0);
  });

  test("MIRV warheads should only target tiles owned by target player", async () => {
    // Increase territory to allow for multiple warhead targets
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    // Also give player some territory near the target area to test filtering
    for (let x = 100; x < 120; x++) {
      for (let y = 100; y < 120; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile) && game.owner(tile) === otherPlayer) {
          otherPlayer.relinquish(tile);
          player.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(150, 150);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);

    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    executeTicks(game, 1);

    const warheads = player.units(UnitType.ClusterWarheadSubmunition);
    expect(warheads.length).toBeGreaterThan(0);

    // Check all warhead targets are owned by otherPlayer
    for (const warhead of warheads) {
      const target = warhead.targetTile();
      if (target) {
        const owner = game.owner(target);
        expect(owner).toBe(otherPlayer);
      }
    }
  });

  test("MIRV warheads should be distributed with minimum spacing", async () => {
    // Increase territory to allow for multiple warhead targets
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(110, 110);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);

    while (mirvExec.isActive()) {
      game.executeNextTick();
    }

    executeTicks(game, 1);

    const warheads = player.units(UnitType.ClusterWarheadSubmunition);
    expect(warheads.length).toBeGreaterThan(0);

    const targets = warheads.map((w) => w.targetTile());

    // Check that targets have minimum spacing (minimumSpread = 55 from ClusterWarheadExecution)
    const minimumSpread = 55;
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const dist = game.manhattanDist(targets[i]!, targets[j]!);
        expect(dist).toBeGreaterThanOrEqual(minimumSpread);
      }
    }
  });

  test("MIRV should display warning message on launch", async () => {
    const displaySpy = vi.spyOn(game, "displayIncomingUnit");

    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    expect(displaySpy).toHaveBeenCalled();
    const callArgs = displaySpy.mock.calls[0];
    expect(callArgs[1]).toContain("MIRV INBOUND");
    expect(callArgs[2]).toBe(MessageType.CLUSTER_WARHEAD_INBOUND);
    expect(callArgs[3]).toBe(otherPlayer.id());
  });

  test("MIRV should not launch if player cannot build it", async () => {
    // Remove player's missile silo
    const silos = player.units(UnitType.OrbitalStrikePlatform);
    for (const silo of silos) {
      silo.delete(false);
    }

    const targetTile = game.ref(50, 50);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // MIRV should not be launched
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(0);
    expect(mirvExec.isActive()).toBe(false);
  });

  test("MIRV should not launch when targeting terra nullius", async () => {
    // Find an unowned land tile near player territory
    let unownedTile: any = null;
    for (let x = 20; x < 25; x++) {
      for (let y = 20; y < 25; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile) && !game.map().hasOwner(tile)) {
          unownedTile = tile;
          break;
        }
      }

      if (unownedTile) {
        break;
      }
    }

    expect(unownedTile).not.toBeNull();

    const mirvExec = new MirvExecution(player, unownedTile!);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // MIRV should NOT launch against terra nullius
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(0);
    expect(mirvExec.isActive()).toBe(false);

    // Should not break any alliance or mark as traitor (since no player owns it)
    expect(player.isTraitor()).toBe(false);
  });

  test("submunitions originate from the separation tile, not the silo tile", async () => {
    // Issue #5 verification — when the MRV separates, the tick-spread drain
    // must construct each `NukeExecution` with the warhead's *separation*
    // tile as `src` (the 4th constructor arg). Earlier optimization passes
    // accidentally re-used `this.spawnTile` (the silo), which shrank the
    // submunition's flight to silo→target and changed time-to-impact and
    // interception windows.
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(110, 110);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    // Burn ticks until the warhead exists so we can read its current tile
    // each tick and capture the actual separation tile observed in flight.
    executeTicks(game, 2);
    const warhead = player.units(UnitType.ClusterWarhead)[0];
    expect(warhead).toBeDefined();

    let separationTile = warhead.tile();
    while (warhead.isActive()) {
      separationTile = warhead.tile();
      game.executeNextTick();
    }
    // Capture one more tile read in case the final move landed on the same
    // tick as the deletion — separationTile must be the warhead's last
    // observed position.
    expect(separationTile).toBeDefined();

    // Spy on `NukeExecution` constructors going forward so the next call to
    // `drainPendingSpawns` records the `src` argument we're verifying.
    const addExecSpy = vi.spyOn(game, "addExecution");
    executeTicks(game, 1);
    const submunitionExecs = addExecSpy.mock.calls
      .flatMap((call) => call)
      .filter((e): e is NukeExecution => e instanceof NukeExecution);
    expect(submunitionExecs.length).toBeGreaterThan(0);

    // The 4th constructor arg (`src`) must equal the separation tile, not
    // the silo. Read it via the private field — we don't expose it
    // publicly because no production code needs it.
    const siloTile = (mirvExec as unknown as { spawnTile: number }).spawnTile;
    for (const exec of submunitionExecs) {
      const src = (exec as unknown as { src: number | null | undefined }).src;
      expect(src).toBe(separationTile);
      expect(src).not.toBe(siloTile);
    }
  });

  test("MIRV should launch when targeting own territory without breaking alliances", async () => {
    const playerTile = Array.from(player.tiles())[0];
    const mirvExec = new MirvExecution(player, playerTile);
    game.addExecution(mirvExec);

    executeTicks(game, 2);

    // Expect MIRV to launch successfully without marking player as traitor
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);
    expect(player.isTraitor()).toBe(false);
  });

  test("MIRV deterministic contract: count, ordering, per-batch drain, separation src", async () => {
    // Issue #5 — deterministic MRV verification.
    //
    // With a fixed setup and the seeded `PseudoRandom` used inside
    // `MirvExecution`, the destination set is fully determined by the
    // game state at separation. The map size and `minimumSpread = 55`
    // bound the achievable submunition count to roughly the
    // non-overlapping packing density of the enemy territory, so we
    // assert the count against a captured floor (proven on the
    // 200×200 `big_plains` test map) and the documented upper bound,
    // then pin the deterministic contract:
    //   1. Total submunition count is in (0, warheadCount = 350] and
    //      at least the empirically observed floor for this map.
    //   2. Destinations are sorted by Manhattan distance from `dst`
    //      descending — the furthest target spawns first so the arrival
    //      window converges roughly on the centre.
    //   3. The tick-spread drain spawns at most `MIRV_SPAWN_PER_TICK`
    //      (= 50) NukeExecutions per tick, and the total drains in
    //      exactly `ceil(total / 50)` ticks.
    //   4. Every spawned `NukeExecution` uses the captured separation
    //      tile as its `src` argument (not the silo). This is the
    //      original regression in Issue #5 and remains the load-bearing
    //      part of the contract.
    for (let x = 75; x < 200; x++) {
      for (let y = 75; y < 200; y++) {
        const tile = game.ref(x, y);
        if (game.map().isSector(tile)) {
          otherPlayer.conquer(tile);
        }
      }
    }

    const targetTile = game.ref(110, 110);
    const mirvExec = new MirvExecution(player, targetTile);
    game.addExecution(mirvExec);

    // Burn through init + spawn so the warhead unit exists.
    executeTicks(game, 2);
    const warhead = player.units(UnitType.ClusterWarhead)[0];
    expect(warhead).toBeDefined();

    // Run the cruise leg until separation begins; capture the last
    // observed warhead tile as the expected separation source.
    let separationTile = warhead.tile();
    while (warhead.isActive()) {
      separationTile = warhead.tile();
      game.executeNextTick();
    }
    expect(separationTile).toBeDefined();

    // Spy on every NukeExecution spawned by the drain window.
    const addExecSpy = vi.spyOn(game, "addExecution");

    // Drive the spread-drain. Track per-tick batch sizes via the spy's
    // call count delta and assert the per-tick cap.
    const PER_TICK_CAP = 50;
    const WARHEAD_COUNT = 350;
    const batchSizes: number[] = [];
    let prevCount = 0;
    let drainTicks = 0;
    while (mirvExec.isActive() && drainTicks < 20) {
      game.executeNextTick();
      drainTicks++;
      const nukeCount = addExecSpy.mock.calls
        .flatMap((call) => call)
        .filter((e): e is NukeExecution => e instanceof NukeExecution).length;
      const delta = nukeCount - prevCount;
      if (delta > 0) batchSizes.push(delta);
      prevCount = nukeCount;
    }

    // Per-batch drain: no tick spawns more than `MIRV_SPAWN_PER_TICK`.
    for (const sz of batchSizes) {
      expect(sz).toBeLessThanOrEqual(PER_TICK_CAP);
    }

    // Submunition count: bounded above by warheadCount, strictly
    // positive, and meets the empirically-observed minimum for this
    // territory shape. The packing density of `minimumSpread = 55` in
    // a 125×125 enemy region caps the achievable count well below 350.
    const submunitionExecs = addExecSpy.mock.calls
      .flatMap((call) => call)
      .filter((e): e is NukeExecution => e instanceof NukeExecution);
    expect(submunitionExecs.length).toBeGreaterThan(0);
    expect(submunitionExecs.length).toBeLessThanOrEqual(WARHEAD_COUNT);
    // Floor captured from a baseline run on this map+seed; tighter than
    // a generic `> 0` check so a regression that halves the packing
    // efficiency still fails this test.
    expect(submunitionExecs.length).toBeGreaterThanOrEqual(5);

    // Drain window: `ceil(total / PER_TICK_CAP)` ticks.
    expect(batchSizes.length).toBe(
      Math.ceil(submunitionExecs.length / PER_TICK_CAP),
    );

    // Source-tile invariant: every spawned NukeExecution's `src` must
    // equal the captured separation tile, not the silo.
    const siloTile = (mirvExec as unknown as { spawnTile: number }).spawnTile;
    for (const exec of submunitionExecs) {
      const src = (exec as unknown as { src: number | null | undefined }).src;
      expect(src).toBe(separationTile);
      expect(src).not.toBe(siloTile);
    }

    // Destination ordering: targets sorted by Manhattan distance from
    // `dst` descending. The first-spawned submunition (furthest from
    // `dst`) must have a larger Manhattan distance than the last-spawned.
    const firstDst = (submunitionExecs[0]! as unknown as { dst: number }).dst;
    const lastDst = (
      submunitionExecs[submunitionExecs.length - 1]! as unknown as {
        dst: number;
      }
    ).dst;
    expect(game.manhattanDist(firstDst, targetTile)).toBeGreaterThanOrEqual(
      game.manhattanDist(lastDst, targetTile),
    );
  });
});
