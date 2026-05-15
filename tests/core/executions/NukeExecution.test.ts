import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("NukeExecution", () => {
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

    (game.config() as TestConfig).nukeMagnitudes = vi.fn(() => ({
      inner: 10,
      outer: 10,
    }));
    (game.config() as TestConfig).nukeAllianceBreakThreshold = vi.fn(() => 5);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    player.conquer(game.ref(1, 1));
  });

  test("nuke should destroy buildings and redraw out of range buildings", async () => {
    // Build a city at (1,1)
    player.buildUnit(UnitType.Colony, game.ref(1, 1), {});
    // Build a missile silo in range
    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(1, 10), {});
    // Build a SAM out of range
    const sam = player.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 11),
      {},
    );
    sam.touch = vi.fn();
    // Build a Defense post out of range AND out of redraw range
    const defensePost = player.buildUnit(
      UnitType.DefenseStation,
      game.ref(1, 27),
      {},
    );
    defensePost.touch = vi.fn();
    // Add a nuke execution targeting the city
    const nukeExec = new NukeExecution(
      UnitType.AntimatterTorpedo,
      player,
      game.ref(1, 1),
      game.ref(1, 2),
    );
    game.addExecution(nukeExec);
    // Run enough ticks for the nuke to detonate
    executeTicks(game, 10);
    // The city and silo should be destroyed
    expect(player.units(UnitType.Colony)).toHaveLength(0);
    expect(player.units(UnitType.OrbitalStrikePlatform)).toHaveLength(0);
    expect(player.units(UnitType.PointDefenseArray)).toHaveLength(1);
    expect(sam.touch).toHaveBeenCalled();
    expect(defensePost.touch).not.toHaveBeenCalled();
  });

  test("nuke should only be targetable near src and dst", async () => {
    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(1, 1), {});
    const nukeExec = new NukeExecution(
      UnitType.AntimatterTorpedo,
      player,
      game.ref(199, 199),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);
    // targetable distance is 400

    //near launch should be targetable (distance src < 400)
    executeTicks(game, 2);
    expect(nukeExec.getNuke()!.isTargetable()).toBeTruthy();

    //mid air should not be targetable (distance src > 400, distance target > 400)
    executeTicks(game, 38);
    expect(nukeExec.getNuke()!.isTargetable()).toBeFalsy();

    //near target should be targetable (distance target < 400)
    executeTicks(game, 35);
    expect(nukeExec.getNuke()!.isTargetable()).toBeTruthy();
  });

  test("nuke should break alliances on launch", async () => {
    const req = player.createAllianceRequest(otherPlayer);
    req!.accept();

    player.conquer(game.ref(1, 1));
    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(1, 1), {});

    for (let x = 90; x < 99; x++) {
      for (let y = 90; y < 99; y++) {
        otherPlayer.conquer(game.ref(x, y));
      }
    }

    // Add a nuke targeting just outside the other player's territory.
    game.addExecution(
      new NukeExecution(
        UnitType.AntimatterTorpedo,
        player,
        game.ref(85, 85),
        null,
      ),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // exec

    expect(player.isTraitor()).toBe(true);
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
  });

  test("nuke should destroy and redraw under-construction structures inside the blast radius", async () => {
    // Comment 2 regression — the bounded `nearbyUnits` scans in
    // `detonate()` and `redrawBuildings()` must include
    // under-construction units. The legacy `mg.units()` loop did not
    // filter on `isUnderConstruction()`, so half-built structures inside
    // the blast were destroyed and touched alongside completed ones.
    // `UnitGrid.nearbyUnits` defaults `includeUnderConstruction` to
    // `false`, which would silently leave under-construction structures
    // alive inside the blast radius.
    //
    // Magnitudes are pinned in the suite-level beforeEach to
    // `{ inner: 10, outer: 10 }`. So the kill radius is `outer = 10` and
    // the redraw band is `outer + SPRITE_RADIUS = 26`. The silo is
    // placed at (1, 30) — distance 29 from `dst (1, 1)` — so it sits
    // outside both bands and survives the blast.
    player.buildUnit(UnitType.Colony, game.ref(1, 1), {});

    // Completed structure inside kill radius (distance 4) — destroyed
    // under the legacy `mg.units()` semantics.
    const completedInRange = player.buildUnit(
      UnitType.DefenseStation,
      game.ref(1, 5),
      {},
    );

    // Under-construction structure inside kill radius (distance 7).
    // Must be destroyed alongside the completed one to match the legacy
    // damage footprint.
    const underConstructionInRange = player.buildUnit(
      UnitType.DefenseStation,
      game.ref(1, 8),
      {},
    );
    underConstructionInRange.setUnderConstruction(true);

    // Under-construction structure inside the redraw band but outside
    // the kill radius (distance 14: > outer=10, < outer+SPRITE_RADIUS=26).
    // Must receive a `touch()` notification so the renderer refreshes
    // it after the detonation flash.
    const underConstructionInRedrawBand = player.buildUnit(
      UnitType.DefenseStation,
      game.ref(1, 15),
      {},
    );
    underConstructionInRedrawBand.setUnderConstruction(true);
    underConstructionInRedrawBand.touch = vi.fn();

    expect(completedInRange.isUnderConstruction()).toBe(false);
    expect(underConstructionInRange.isUnderConstruction()).toBe(true);

    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(1, 30), {});
    const nukeExec = new NukeExecution(
      UnitType.AntimatterTorpedo,
      player,
      game.ref(1, 1),
      null,
    );
    game.addExecution(nukeExec);

    // Run the simulation until the nuke deactivates (post-detonation)
    // or a generous safety cap. The parabolic pathfinder loft makes the
    // exact tick count fixture-sensitive; we just want to be past
    // detonation regardless of speed/parabola tuning.
    let ticksRan = 0;
    while (nukeExec.isActive() && ticksRan < 200) {
      game.executeNextTick();
      ticksRan++;
    }
    expect(nukeExec.isActive()).toBe(false);

    // Both the completed and under-construction structures inside the
    // kill radius must be gone — same footprint as the legacy loop.
    expect(completedInRange.isActive()).toBe(false);
    expect(underConstructionInRange.isActive()).toBe(false);

    // The under-construction structure in the redraw band must have
    // been `touch()`ed so the renderer can refresh it post-blast.
    expect(underConstructionInRedrawBand.touch).toHaveBeenCalled();
  });

  test("nuke should break alliance when destroying ally's building even with few tiles", async () => {
    const req = player.createAllianceRequest(otherPlayer);
    req!.accept();

    expect(player.isAlliedWith(otherPlayer)).toBe(true);

    player.conquer(game.ref(1, 1));
    player.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(1, 1), {});

    // Give the other player just a few tiles (below the threshold of 5)
    // and build a port on one of them
    otherPlayer.conquer(game.ref(50, 50));
    otherPlayer.conquer(game.ref(51, 50));
    otherPlayer.conquer(game.ref(50, 51));
    otherPlayer.buildUnit(UnitType.Spaceport, game.ref(50, 50), {});

    expect(otherPlayer.units(UnitType.Spaceport)).toHaveLength(1);

    // Nuke targeting the ally's port - this should break alliance
    // even though the tile count is below threshold
    game.addExecution(
      new NukeExecution(
        UnitType.AntimatterTorpedo,
        player,
        game.ref(50, 50),
        null,
      ),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // exec

    // Alliance should be broken because we're destroying ally's building
    expect(player.isTraitor()).toBe(true);
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
  });
});
