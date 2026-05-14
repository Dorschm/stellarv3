// @vitest-environment node
import { BattlecruiserExecution } from "../../../src/core/execution/BattlecruiserExecution";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

/**
 * Tests for GDD §14 / Ticket 6 — Battlecruiser one-slot structure hosting.
 *
 * A Battlecruiser acts as a "mobile one-slot planet": it can host a single
 * DefenseStation or OrbitalStrikePlatform. When the cruiser moves, the
 * hosted structure moves with it; when the cruiser dies, the hosted
 * structure is destroyed too.
 *
 * Issue #7 — hosting is *only* triggered by an explicit `hostBattlecruiserId`
 * on the originating intent (see `HostOnlyConstruction.test.ts`). A plain
 * `ConstructionExecution` near an empty cruiser must take the ground path
 * and leave the cruiser's slot empty. The slot lifecycle tests below
 * attach structures via `setSlottedStructure` directly rather than relying
 * on proximity-based auto-hosting.
 */

const gameID: GameID = "bc_slot_game";

let game: Game;
let pilot: Player;

async function buildGame() {
  game = await setup("big_plains", {
    infiniteCredits: true,
    instantBuild: true,
  });
  game.addPlayer(new PlayerInfo("pilot", PlayerType.Human, null, "pilot"));
  game.addExecution(
    new SpawnExecution(gameID, game.player("pilot").info(), game.ref(5, 5)),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  pilot = game.player("pilot");
}

/**
 * Spawn a Battlecruiser directly at the given tile and wire its execution.
 * Using `buildUnit` bypasses the `canBuild` precondition, so the cruiser is
 * active immediately and its execution starts patrolling on the next tick.
 */
function spawnBattlecruiser(patrolTile = game.ref(5, 5)): Unit {
  const bc = pilot.buildUnit(UnitType.Battlecruiser, patrolTile, {
    patrolTile,
  });
  game.addExecution(new BattlecruiserExecution(bc));
  return bc;
}

describe("Battlecruiser structure slot — attachment", () => {
  beforeEach(async () => {
    await buildGame();
  });

  test("slot starts empty on a fresh Battlecruiser", () => {
    const bc = spawnBattlecruiser();
    expect(bc.slottedStructure()).toBeUndefined();
  });

  test("setSlottedStructure attaches a structure and throws on double-assign", () => {
    const bc = spawnBattlecruiser();

    // Build a ground DefenseStation we can attach for the test. Using
    // buildUnit directly gives us an isolated instance that isn't yet
    // wired into any cruiser.
    const ds = pilot.buildUnit(UnitType.DefenseStation, game.ref(10, 10), {});

    bc.setSlottedStructure(ds);
    expect(bc.slottedStructure()).toBe(ds);

    // Double-assign must throw — we don't want a silent overwrite that
    // would leak the previously-hosted structure.
    const ds2 = pilot.buildUnit(UnitType.DefenseStation, game.ref(11, 11), {});
    expect(() => bc.setSlottedStructure(ds2)).toThrow();
  });

  test("plain ConstructionExecution near an empty-slot cruiser builds on the ground and leaves the slot empty", () => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);
    expect(bc.slottedStructure()).toBeUndefined();

    const dsCountBefore = pilot.units(UnitType.DefenseStation).length;

    // Issue #7 regression — a `ConstructionExecution` without an explicit
    // `hostBattlecruiserId` must NEVER proximity-host. The cruiser's slot
    // stays empty; the build either lands on the ground or fails canBuild.
    game.addExecution(
      new ConstructionExecution(pilot, UnitType.DefenseStation, patrolTile),
    );
    executeTicks(game, 4);

    expect(bc.slottedStructure()).toBeUndefined();
    // If a structure was produced at all it lives on the ground (i.e. not
    // attached to the cruiser slot). The ground-path canBuild may reject
    // the tile entirely on this map; either outcome is acceptable as long
    // as the cruiser's slot was not silently filled.
    for (const ds of pilot.units(UnitType.DefenseStation)) {
      expect(bc.slottedStructure()).not.toBe(ds);
    }
    expect(pilot.units(UnitType.DefenseStation).length).toBeGreaterThanOrEqual(
      dsCountBefore,
    );
  });

  test("plain ConstructionExecution does not slot OrbitalStrikePlatform onto a nearby cruiser", () => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    game.addExecution(
      new ConstructionExecution(
        pilot,
        UnitType.OrbitalStrikePlatform,
        patrolTile,
      ),
    );
    executeTicks(game, 4);

    expect(bc.slottedStructure()).toBeUndefined();
  });
});

describe("Battlecruiser structure slot — lifecycle", () => {
  beforeEach(async () => {
    await buildGame();
  });

  test("slotted structure moves with the cruiser every tick", () => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    const ds = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(ds);
    expect(ds.tile()).toBe(bc.tile());

    // Run several ticks so the cruiser's patrol logic has a chance to
    // move it. `syncSlottedStructure` is called at the end of every
    // BattlecruiserExecution tick, so after any motion the slotted
    // structure must be on the same tile.
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      expect(ds.tile()).toBe(bc.tile());
    }
  });

  test("destroying the cruiser cascade-deletes the slotted structure", () => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    const ds = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(ds);
    expect(ds.isActive()).toBe(true);

    // Delete the cruiser directly — UnitImpl.delete cascades into the
    // slotted structure.
    bc.delete();

    expect(bc.isActive()).toBe(false);
    expect(ds.isActive()).toBe(false);
  });

  test("slot is cleared if the hosted structure dies independently", () => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    // The first tick after addExecution only runs init(); the execution
    // is not ticked until the *next* call to executeNextTick(). Burn one
    // tick so the BattlecruiserExecution is fully initialised and queued.
    game.executeNextTick();

    const ds = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(ds);
    expect(bc.slottedStructure()).toBe(ds);

    // Killing the structure first simulates it being destroyed by e.g. a
    // nuke. The next BattlecruiserExecution tick should detect the dead
    // structure via syncSlottedStructure() and clear the slot.
    ds.delete();

    // Run a tick so syncSlottedStructure() runs.
    game.executeNextTick();

    expect(bc.isActive()).toBe(true);
    expect(bc.slottedStructure()).toBeUndefined();
  });

  test("after slot is cleared, a new structure can be attached", () => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    // Burn the init tick so the execution is queued for ticking.
    game.executeNextTick();

    const ds = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(ds);
    ds.delete();
    game.executeNextTick(); // clears the slot via syncSlottedStructure

    expect(bc.slottedStructure()).toBeUndefined();

    const ds2 = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(ds2);
    expect(bc.slottedStructure()).toBe(ds2);
  });
});
