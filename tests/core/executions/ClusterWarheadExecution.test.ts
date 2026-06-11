import { MirvExecution } from "../../../src/core/execution/ClusterWarheadExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { PointDefenseArrayExecution } from "../../../src/core/execution/PointDefenseArrayExecution";
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
    // `displayIncomingUnit` receives a translation KEY, not the
    // localized English string — the HUD resolves the key against
    // `en.json` at render time (currently "⚠️⚠️⚠️ {name} - CLUSTER
    // WARHEAD INBOUND ⚠️⚠️⚠️"). The previous assertion checked the
    // resolved English literal "MIRV INBOUND" and was always stale
    // against the actual contract.
    expect(callArgs[1]).toBe("events_display.cluster_warhead_inbound");
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

    // End-to-end check: advance one more tick so each newly queued
    // NukeExecution actually runs its first `tick()` and builds the
    // submunition Unit. Assert the resulting ClusterWarheadSubmunition
    // is created at the captured separation tile — not at the
    // destination (which is what `canBuild(submunition, dst)` returns
    // via `PlayerImpl.canSpawnUnitType`) and not at the silo. Without
    // driving the spawn through `tick()`, a buggy implementation that
    // overwrites `this.src` with `canBuild`'s return value would still
    // pass the constructor-arg assertion above.
    executeTicks(game, 1);
    const submunitionUnits = player.units(UnitType.ClusterWarheadSubmunition);
    expect(submunitionUnits.length).toBeGreaterThan(0);
    for (const unit of submunitionUnits) {
      expect(unit.tile()).toBe(separationTile);
      expect(unit.tile()).not.toBe(siloTile);
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

  test("MIRV deterministic contract: count, full destination ordering, per-batch drain, separation src", async () => {
    // Issue #5 — deterministic MRV verification.
    //
    // With a fixed setup and the seeded `PseudoRandom` used inside
    // `MirvExecution`, the destination set is fully determined by the
    // game state at separation. We pin the deterministic contract for
    // this exact fixture (200×200 `big_plains`, enemy territory in
    // x,y ∈ [25, 200) once the `beforeEach` block and the additional
    // grab below combine, single MRV aimed at `(110, 110)`,
    // `minimumSpread = 55`, `warheadCount = 350`) and assert:
    //
    //   1. Total submunition count is exactly `EXPECTED_COUNT` for this
    //      fixed seed — no more "> 0 / <= 350 / >= floor" smoke check.
    //      A change in the RNG stream, the packing predicate, or the
    //      target filter shifts the count and flips this assertion
    //      immediately. The product decision to change this number must
    //      be explicit (update `EXPECTED_COUNT`) and visible in the
    //      diff.
    //   2. The ordered destination list matches the fixed
    //      `EXPECTED_DESTINATIONS` array. Equality is by-element, so
    //      ANY drift — count, order, or coordinates — fails the test.
    //      Additionally, every adjacent pair must stay in non-increasing
    //      Manhattan-distance order from `dst` (the furthest target
    //      spawns first so the arrival window converges on the centre).
    //   3. The tick-spread drain spawns at most `MIRV_SPAWN_PER_TICK`
    //      (= 20) NukeExecutions per tick, and the total drains in
    //      exactly `ceil(total / 20)` ticks.
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
    const PER_TICK_CAP = 20;
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

    const submunitionExecs = addExecSpy.mock.calls
      .flatMap((call) => call)
      .filter((e): e is NukeExecution => e instanceof NukeExecution);

    // Exact count for the fixed setup. The 200×200 `big_plains` map
    // bounded by `minimumSpread = 55` packs to this exact cardinality
    // under the seeded RNG. If product changes the seed, map size, or
    // packing predicate this constant must be updated in lockstep —
    // the test failing here is *the point* of the deterministic
    // contract.
    const EXPECTED_COUNT = 8;
    expect(submunitionExecs.length).toBe(EXPECTED_COUNT);
    // Hard upper bound from `warheadCount` is still an invariant: the
    // count must never exceed the configured payload size regardless
    // of the seed.
    expect(submunitionExecs.length).toBeLessThanOrEqual(WARHEAD_COUNT);

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

    // Full ordered destination list. We pin the deterministic spawn
    // order as a literal array — a change in the RNG stream OR the
    // sort comparator both fail this `toEqual`. Stored as (x, y)
    // pairs so the diff is readable on regression.
    const orderedDestinations = submunitionExecs.map((exec) => {
      const dst = (exec as unknown as { dst: number }).dst;
      return [game.x(dst), game.y(dst)];
    });
    const EXPECTED_DESTINATIONS: [number, number][] = [
      [181, 185],
      [43, 34],
      [183, 124],
      [64, 72],
      [77, 146],
      [113, 173],
      [156, 91],
      [110, 110],
    ];
    expect(orderedDestinations).toEqual(EXPECTED_DESTINATIONS);

    // Adjacency invariant — independent of the literal pin: every
    // adjacent pair must remain in non-increasing Manhattan-distance
    // order from `dst`. This catches a corrupted sort even if the
    // expected array above happens to coincidentally agree at the
    // endpoints.
    for (let i = 1; i < submunitionExecs.length; i++) {
      const prevDst = (submunitionExecs[i - 1]! as unknown as { dst: number })
        .dst;
      const nextDst = (submunitionExecs[i]! as unknown as { dst: number }).dst;
      const prevMd = game.manhattanDist(prevDst, targetTile);
      const nextMd = game.manhattanDist(nextDst, targetTile);
      expect(prevMd).toBeGreaterThanOrEqual(nextMd);
    }
  });

  test("cluster submunition detonations are throttled to 2 per tick", async () => {
    // Spawn more than 2 `ClusterWarheadSubmunition` NukeExecutions whose
    // `src === dst`, so every one of them reaches `PathStatus.COMPLETE` on
    // the same tick. The per-tick throttle must let at most 2 detonate per
    // tick, leaving the rest active to retry on later ticks — total count
    // and eventual damage are preserved, only the timing spreads.
    const targetTile = game.ref(50, 50);
    expect(game.owner(targetTile)).toBe(otherPlayer);

    const SUBMUNITION_COUNT = 8;
    const execs: NukeExecution[] = [];
    for (let i = 0; i < SUBMUNITION_COUNT; i++) {
      // src === dst → the parabola curve is degenerate and the execution
      // reaches COMPLETE as soon as it can move, so all 8 are ready to
      // detonate on the same tick.
      const exec = new NukeExecution(
        UnitType.ClusterWarheadSubmunition,
        player,
        targetTile,
        targetTile,
      );
      execs.push(exec);
      game.addExecution(exec);
    }

    // Advance ticks, recording how many submunition executions finish
    // (detonate → inactive) on each tick.
    const perTickDetonations: number[] = [];
    let prevInactive = 0;
    let guard = 0;
    while (execs.some((e) => e.isActive()) && guard < 50) {
      game.executeNextTick();
      guard++;
      const inactive = execs.filter((e) => !e.isActive()).length;
      const delta = inactive - prevInactive;
      if (delta > 0) perTickDetonations.push(delta);
      prevInactive = inactive;
    }

    // Acceptance criterion 1 — no tick detonates more than 2.
    for (const detonations of perTickDetonations) {
      expect(detonations).toBeLessThanOrEqual(2);
    }
    // Acceptance criterion 4 — every submunition eventually detonates.
    expect(prevInactive).toBe(SUBMUNITION_COUNT);
    // Acceptance criterion 6 — 8 submunitions at 2/tick must spread across
    // at least ceil(8 / 2) = 4 ticks.
    expect(perTickDetonations.length).toBeGreaterThanOrEqual(4);
  });

  test("throttled-but-ready submunitions are not erased by point defense", async () => {
    // Regression — throttled cluster submunitions must keep their damage.
    //
    // A `ClusterWarheadSubmunition` that has reached `PathStatus.COMPLETE`
    // but was deferred by the per-tick detonation throttle is guaranteed to
    // detonate on a later tick. While deferred it stays an active unit, so a
    // PDA covering the impact area used to scan it as an ordinary in-flight
    // submunition and delete it — erasing an explosion that was only delayed
    // for performance and cutting total submunition damage below the
    // un-throttled baseline. Every deferred submunition must still detonate.
    const targetTile = game.ref(50, 50);
    expect(game.owner(targetTile)).toBe(otherPlayer);

    // Defender PDA sitting on the impact area: every submunition's
    // `targetTile` is inside `clusterWarheadProtectionRadius` (50 manhattan
    // tiles of the PDA), so the PDA would intercept any submunition it is
    // allowed to scan.
    const pdaTile = game.ref(52, 52);
    expect(game.map().isSector(pdaTile)).toBe(true);
    const pda = otherPlayer.buildUnit(UnitType.PointDefenseArray, pdaTile, {});
    expect(pda.isUnderConstruction()).toBe(false);

    // Count real detonations vs PDA interceptions via the stats sink.
    const stats = game.stats();
    const landSpy = vi.spyOn(stats, "bombLand");
    const interceptSpy = vi.spyOn(stats, "bombIntercept");

    // More than the 2/tick throttle cap, so several submunitions are always
    // sitting in the deferred pending-detonation state at once.
    const SUBMUNITION_COUNT = 15;
    const execs: NukeExecution[] = [];
    for (let i = 0; i < SUBMUNITION_COUNT; i++) {
      // src === dst → degenerate parabola, so every submunition reaches
      // COMPLETE on the same tick and the throttle must defer most of them.
      const exec = new NukeExecution(
        UnitType.ClusterWarheadSubmunition,
        player,
        targetTile,
        targetTile,
      );
      execs.push(exec);
      game.addExecution(exec);
    }

    // Run until the submunition units have been built (they are now
    // in-flight, none deferred yet). Only then add the PDA execution — this
    // keeps the PDA inactive during the legitimate in-flight tick and makes
    // its first scan land on a tick where submunitions are already deferred,
    // exactly the "later PDA execution" the regression describes.
    let guard = 0;
    while (
      player.units(UnitType.ClusterWarheadSubmunition).length <
        SUBMUNITION_COUNT &&
      guard < 20
    ) {
      game.executeNextTick();
      guard++;
    }
    expect(player.units(UnitType.ClusterWarheadSubmunition).length).toBe(
      SUBMUNITION_COUNT,
    );
    game.addExecution(new PointDefenseArrayExecution(otherPlayer, null, pda));

    while (execs.some((e) => e.isActive()) && guard < 80) {
      game.executeNextTick();
      guard++;
    }
    expect(execs.some((e) => e.isActive())).toBe(false);

    // Every submunition detonated; the PDA intercepted none of them.
    const detonations = landSpy.mock.calls.filter(
      (call) => call[2] === UnitType.ClusterWarheadSubmunition,
    ).length;
    expect(detonations).toBe(SUBMUNITION_COUNT);

    const intercepted = interceptSpy.mock.calls
      .filter((call) => call[1] === UnitType.ClusterWarheadSubmunition)
      .reduce((sum, call) => sum + (call[2] as number), 0);
    expect(intercepted).toBe(0);
  });

  test("non-cluster nukes (AntimatterTorpedo) are not throttled", async () => {
    // The cluster throttle must scope to `ClusterWarheadSubmunition` only.
    // Give each AntimatterTorpedo its own OrbitalStrikePlatform, with the
    // platform → target offset vector identical for every pair (always
    // (0, +5)). Identical relative geometry means identical parabolic
    // flight, so all torpedoes reach `PathStatus.COMPLETE` on the same
    // tick. With 8 detonations on one tick (> the 3/tick cluster cap),
    // this proves non-cluster nukes are never deferred.
    const platformTiles: [number, number][] = [
      [30, 30],
      [40, 30],
      [50, 30],
      [60, 30],
      [30, 45],
      [40, 45],
      [50, 45],
      [60, 45],
    ];
    for (const [x, y] of platformTiles) {
      const tile = game.ref(x, y);
      expect(game.map().isSector(tile)).toBe(true);
      player.conquer(tile);
      player.buildUnit(UnitType.OrbitalStrikePlatform, tile, {});
    }

    const TORPEDO_COUNT = platformTiles.length;
    const execs: NukeExecution[] = [];
    for (const [x, y] of platformTiles) {
      // Target tile sits 5 tiles south of its own platform. `canBuild` →
      // `nukeSpawn` picks the closest platform by Manhattan distance, so
      // each torpedo launches from its dedicated platform — distinct
      // platforms mean no launch-cooldown contention, and the identical
      // (0, +5) offset makes every flight the same length.
      const exec = new NukeExecution(
        UnitType.AntimatterTorpedo,
        player,
        game.ref(x, y + 5),
      );
      execs.push(exec);
      game.addExecution(exec);
    }

    const perTickDetonations: number[] = [];
    let prevInactive = 0;
    let guard = 0;
    while (execs.some((e) => e.isActive()) && guard < 100) {
      game.executeNextTick();
      guard++;
      const inactive = execs.filter((e) => !e.isActive()).length;
      const delta = inactive - prevInactive;
      if (delta > 0) perTickDetonations.push(delta);
      prevInactive = inactive;
    }

    // All torpedoes detonate, and the busiest tick sees more than 3 go off
    // at once — the cluster cap does not apply to them.
    expect(prevInactive).toBe(TORPEDO_COUNT);
    expect(Math.max(...perTickDetonations)).toBeGreaterThan(3);
  });

  test("MIRV launch does not freeze the game: bounded per-tick cost, no path-not-found floods, forward progress", async () => {
    // Freeze regression — fix commits `87626c7` (path-not-found floods from a
    // corrupted `separateDst` after a misplaced `mg.x(...)` wrap) and the
    // tick-spread drain in `MirvExecution` (350 NukeExecutions used to be
    // added in a single tick, spiking the executor queue and the renderer
    // hard).
    //
    // We exercise the full end-to-end flow — silo → cruise → separation →
    // tick-spread spawn drain → submunition flight → impact — and pin three
    // load-bearing invariants:
    //
    //   1. The game advances on every tick (no infinite loop / stall).
    //   2. No `console.warn("cannot build ClusterWarhead")` and no
    //      `console.log("path not found")` floods appear. We allow at most
    //      a small constant from unrelated AI/transit code, but the count
    //      must not scale with the number of submunitions.
    //   3. Per-tick wall time stays bounded. We don't pin a strict latency
    //      number (varies by host), but every tick must complete inside a
    //      generous 5-second budget — anything beyond that is a real
    //      freeze, not a slow CI box.
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

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Hard cap so a real freeze (true infinite loop) surfaces as a test
    // timeout rather than hanging this test forever.
    const MAX_TICKS = 800;
    const TICK_BUDGET_MS = 5_000;
    let ticksRan = 0;
    let prevTick = game.ticks();
    while (mirvExec.isActive() && ticksRan < MAX_TICKS) {
      const start = Date.now();
      game.executeNextTick();
      const elapsed = Date.now() - start;
      // Pin 3 — per-tick latency. The original freeze showed up as a
      // single tick taking minutes (the parabola pathfinder being asked
      // to reach `(garbage, garbage)`).
      expect(elapsed).toBeLessThan(TICK_BUDGET_MS);
      // Pin 1 — forward progress. The game's internal tick counter must
      // strictly advance, even when the MRV is mid-drain. The pre-fix
      // freeze symptom was a tick that effectively never returned, but
      // a quieter variant (executor stuck on a pending exec) would
      // show as ticks() not advancing.
      const nextTick = game.ticks();
      expect(nextTick).toBeGreaterThan(prevTick);
      prevTick = nextTick;
      ticksRan++;
    }

    // The full MRV flight + separation + drain finished before
    // `MAX_TICKS` — i.e. we did not just survive a timeout, we actually
    // saw the execution deactivate.
    expect(mirvExec.isActive()).toBe(false);

    // Pin 2 — log floods. The "path not found" stream from the bugged
    // `separateDst` produced one message per tick of the cruise leg
    // (~50+ messages), so we cap at 5 to leave room for unrelated AI
    // routing prints without letting a freeze-class regression slip
    // through.
    const pathNotFoundLogs = logSpy.mock.calls.filter((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("path not found"),
      ),
    );
    expect(pathNotFoundLogs.length).toBeLessThanOrEqual(5);
    const cannotBuildWarns = warnSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes("cannot build ClusterWarhead"),
      ),
    );
    expect(cannotBuildWarns.length).toBe(0);

    logSpy.mockRestore();
    warnSpy.mockRestore();

    // Submunitions actually spawned — this prevents a degenerate "MIRV
    // never separated" pass that would silently satisfy the timing and
    // log pins. The drain queues `NukeExecution`s via `addExecution`,
    // and the FIRST tick each NukeExecution runs is when it calls
    // `buildUnit` to produce the `ClusterWarheadSubmunition`. So we
    // need at least one tick after `mirvExec.isActive()` flips to
    // false for the submunition units to exist on the player. Cap that
    // post-drain wait too so a stall after separation still surfaces
    // as a test failure rather than a hang.
    const POST_DRAIN_BUDGET = 3;
    let postTicks = 0;
    while (
      player.units(UnitType.ClusterWarheadSubmunition).length === 0 &&
      postTicks < POST_DRAIN_BUDGET
    ) {
      const start = Date.now();
      game.executeNextTick();
      expect(Date.now() - start).toBeLessThan(TICK_BUDGET_MS);
      postTicks++;
    }
    expect(
      player.units(UnitType.ClusterWarheadSubmunition).length,
    ).toBeGreaterThan(0);
  });
});
