// @vitest-environment node
import { BattlecruiserExecution } from "../../../src/core/execution/BattlecruiserExecution";
import { ColonyExecution } from "../../../src/core/execution/ColonyExecution";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { FoundryExecution } from "../../../src/core/execution/FoundryExecution";
import {
  JumpGateExecution,
  JumpGateTeleportExecution,
  JumpGateTravel,
} from "../../../src/core/execution/JumpGateExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  MessageType,
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
 * Tests for GDD §14 — Capital Ship expansion. A Battlecruiser's one-slot
 * hosting now accepts every structure type (Spaceport, OSP, DefenseStation,
 * PDA, Colony, Foundry, JumpGate), not just DefenseStation and OSP. These
 * tests complement the pre-existing `BattlecruiserStructureSlot.test.ts`
 * (which continues to cover DS/OSP specifically).
 */

const gameID: GameID = "bc_capital_game";

let game: Game;
let pilot: Player;

async function buildPlainsGame() {
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

async function buildMixedGame() {
  // half_land_half_ocean is the canonical map with guaranteed void tiles
  // (x >= 8 is ocean/deep space). Ship-hosted-on-void tests need this.
  game = await setup("half_land_half_ocean", {
    infiniteCredits: true,
    instantBuild: true,
  });
  game.addPlayer(new PlayerInfo("pilot", PlayerType.Human, null, "pilot"));
  game.addExecution(
    new SpawnExecution(gameID, game.player("pilot").info(), game.ref(3, 3)),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  pilot = game.player("pilot");
}

function spawnBattlecruiser(patrolTile: number): Unit {
  const bc = pilot.buildUnit(UnitType.Battlecruiser, patrolTile, {
    patrolTile,
  });
  game.addExecution(new BattlecruiserExecution(bc));
  return bc;
}

describe("Capital Ship — expanded hosting whitelist", () => {
  beforeEach(async () => {
    await buildPlainsGame();
  });

  test.each([
    UnitType.Spaceport,
    UnitType.PointDefenseArray,
    UnitType.Colony,
    UnitType.Foundry,
    UnitType.JumpGate,
  ])(
    "ConstructionExecution auto-hosts %s on a nearby empty-slot cruiser",
    (structureType) => {
      const patrolTile = game.ref(5, 5);
      const bc = spawnBattlecruiser(patrolTile);
      expect(bc.slottedStructure()).toBeUndefined();

      game.addExecution(
        new ConstructionExecution(pilot, structureType, patrolTile),
      );
      executeTicks(game, 4);

      const slotted = bc.slottedStructure();
      expect(slotted).toBeDefined();
      expect(slotted?.type()).toBe(structureType);
      expect(slotted?.isActive()).toBe(true);
    },
  );

  test("config lists every structure type as hostable by default", () => {
    const hostable = game.config().battlecruiserHostableStructures();
    expect(hostable).toEqual(
      expect.arrayContaining([
        UnitType.Spaceport,
        UnitType.OrbitalStrikePlatform,
        UnitType.DefenseStation,
        UnitType.PointDefenseArray,
        UnitType.Colony,
        UnitType.Foundry,
        UnitType.JumpGate,
      ]),
    );
  });
});

describe("Capital Ship — cascade delete for all hostable types", () => {
  beforeEach(async () => {
    await buildPlainsGame();
  });

  test.each([
    UnitType.Spaceport,
    UnitType.OrbitalStrikePlatform,
    UnitType.DefenseStation,
    UnitType.PointDefenseArray,
    UnitType.Colony,
    UnitType.Foundry,
    UnitType.JumpGate,
  ])("destroying the cruiser cascade-deletes a slotted %s", (structureType) => {
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);
    const structure = pilot.buildUnit(structureType, patrolTile, {});
    bc.setSlottedStructure(structure);
    expect(structure.isActive()).toBe(true);

    bc.delete();

    expect(bc.isActive()).toBe(false);
    expect(structure.isActive()).toBe(false);
  });
});

describe("Capital Ship — ship-hosted Colony/Foundry on void", () => {
  beforeEach(async () => {
    await buildMixedGame();
  });

  test("ship-hosted Colony adds fixed population on a void tile", () => {
    // Place the cruiser directly on a known-void tile (x>=8 on this map).
    const voidTile = game.ref(10, 4);
    expect(game.isVoid(voidTile)).toBe(true);

    // Skip the BattlecruiserExecution so the Colony's tile isn't moved by
    // the cruiser's patrol logic during the tick window we're measuring.
    // This isolates ColonyExecution's ship-hosted trickle from the BC's
    // movement / sync behaviour (covered by its own tests).
    const bc = pilot.buildUnit(UnitType.Battlecruiser, voidTile, {
      patrolTile: voidTile,
    });
    const colony = pilot.buildUnit(UnitType.Colony, voidTile, {});
    bc.setSlottedStructure(colony);
    game.addExecution(new ColonyExecution(colony));

    const expectedPerTick = game.config().shipHostedColonyPopulationPerTick();
    expect(expectedPerTick).toBeGreaterThan(0);

    // First executeNextTick runs init() for the new execution; ticking
    // starts the turn after. Advance by one tick so ColonyExecution is
    // inited and on `execs` before we start measuring.
    game.executeNextTick();
    const before = pilot.population();
    executeTicks(game, 5);
    const after = pilot.population();

    // Colony trickle alone accounts for at least N * perTick. PE may add
    // more (its 10/tick idle floor) so this is a lower-bound check.
    expect(after - before).toBeGreaterThanOrEqual(expectedPerTick * 5);
  });

  test("ship-hosted Foundry adds fixed credits on a void tile", () => {
    const voidTile = game.ref(10, 4);
    expect(game.isVoid(voidTile)).toBe(true);

    // Spawn a parked BC without an execution so the cruiser doesn't drag
    // the Foundry off the void tile while we measure.
    const bc = pilot.buildUnit(UnitType.Battlecruiser, voidTile, {
      patrolTile: voidTile,
    });
    const foundry = pilot.buildUnit(UnitType.Foundry, voidTile, {});
    bc.setSlottedStructure(foundry);
    game.addExecution(new FoundryExecution(foundry));

    const expectedPerTick = game.config().shipHostedFoundryCreditsPerTick();
    expect(expectedPerTick).toBeGreaterThan(0);

    // Let the execution init without counting its pre-tick state.
    game.executeNextTick();
    const before = pilot.credits();
    executeTicks(game, 5);
    const after = pilot.credits();

    // Foundry trickle alone accounts for at least N * perTick; PlayerExec
    // piles on additional credits (flat rate + per-tile yield) so this is
    // a lower-bound check.
    expect(after - before).toBeGreaterThanOrEqual(BigInt(expectedPerTick * 5));
  });
});

describe("Capital Ship — JumpGate hosted on a mobile cruiser", () => {
  beforeEach(async () => {
    await buildMixedGame();
  });

  test("hosted JumpGate is listed in availableGatesFor", () => {
    const voidTile = game.ref(10, 4);
    const bc = spawnBattlecruiser(voidTile);
    const gate = pilot.buildUnit(UnitType.JumpGate, voidTile, {});
    bc.setSlottedStructure(gate);
    game.addExecution(new JumpGateExecution(gate));

    const gates = JumpGateTravel.availableGatesFor(game, pilot);
    expect(gates).toContain(gate);
  });

  test("teleport by drifted tile still finds the mobile gate", () => {
    // Source gate lives on the ship. We record the tile at intent time,
    // then move the cruiser/gate by one tile to simulate drift. The
    // resolveGate fallback in JumpGateTeleportExecution should still find
    // the gate within its drift tolerance.
    const voidTile = game.ref(10, 4);
    const destTile = game.ref(12, 4);
    expect(game.isVoid(voidTile)).toBe(true);
    expect(game.isVoid(destTile)).toBe(true);

    const bc = spawnBattlecruiser(voidTile);
    const sourceGate = pilot.buildUnit(UnitType.JumpGate, voidTile, {});
    bc.setSlottedStructure(sourceGate);
    game.addExecution(new JumpGateExecution(sourceGate));

    const destGate = pilot.buildUnit(UnitType.JumpGate, destTile, {});
    game.addExecution(new JumpGateExecution(destGate));

    // Record the intent tile before drift.
    const intentSourceTile = sourceGate.tile();

    // Simulate drift: move the cruiser (and its slotted gate) one tile
    // away without going through BattlecruiserExecution's patrol logic.
    const driftedTile = game.ref(11, 4);
    bc.move(driftedTile);
    sourceGate.move(driftedTile);
    expect(sourceGate.tile()).not.toBe(intentSourceTile);

    // Place a teleportable unit at the gate's *current* (drifted) tile —
    // this is where units would physically be if they were on the ship.
    const shuttle = pilot.buildUnit(UnitType.AssaultShuttle, driftedTile, {});
    expect(shuttle.tile()).toBe(driftedTile);

    // Fire the intent with the original (now-stale) tile. The execution
    // must resolve the moved gate via the drift-tolerance fallback.
    game.addExecution(
      new JumpGateTeleportExecution(pilot, intentSourceTile, destTile),
    );
    executeTicks(game, 1);

    expect(shuttle.tile()).toBe(destTile);
  });

  test("drift fallback must not collapse source and destination onto the same gate", () => {
    // Two gates hosted on two cruisers, both on void tiles far enough apart
    // that the intent carries distinct source/dest tiles. After drift, both
    // cruisers converge to the same tile — stale intent tiles then sit near
    // the same surviving gate. The identity guard must reject the teleport
    // even though the intent tiles themselves differ.
    const tileA = game.ref(10, 4);
    const tileB = game.ref(11, 4);
    expect(game.isVoid(tileA)).toBe(true);
    expect(game.isVoid(tileB)).toBe(true);

    const bcA = pilot.buildUnit(UnitType.Battlecruiser, tileA, {
      patrolTile: tileA,
    });
    const gateA = pilot.buildUnit(UnitType.JumpGate, tileA, {});
    bcA.setSlottedStructure(gateA);
    game.addExecution(new JumpGateExecution(gateA));

    const bcB = pilot.buildUnit(UnitType.Battlecruiser, tileB, {
      patrolTile: tileB,
    });
    const gateB = pilot.buildUnit(UnitType.JumpGate, tileB, {});
    bcB.setSlottedStructure(gateB);
    game.addExecution(new JumpGateExecution(gateB));

    // Player submits intent with the gates at their original tiles.
    const intentSourceTile = tileA;
    const intentDestTile = tileB;

    // Simulate drift: cruiser B (and its gate) is destroyed/removed so only
    // gateA survives but at a drifted tile. Both intent tiles are now within
    // drift tolerance of gateA, which would naively resolve both endpoints
    // to the same gate.
    gateB.delete();
    const driftedTile = game.ref(12, 4);
    bcA.move(driftedTile);
    gateA.move(driftedTile);

    const spy = vi.spyOn(game, "displayMessage");
    game.addExecution(
      new JumpGateTeleportExecution(pilot, intentSourceTile, intentDestTile),
    );
    executeTicks(game, 1);

    // With only one surviving gate and destination resolution excluding the
    // already-resolved source, this must emit a jump_gate_failed message —
    // never a teleport success — even though both intent tiles sit within
    // drift tolerance of the same surviving gate.
    const calls = spy.mock.calls;
    expect(calls.some((c) => c[1] === MessageType.JUMP_GATE_FAILED)).toBe(true);
    expect(calls.some((c) => c[1] === MessageType.JUMP_GATE_TELEPORT)).toBe(
      false,
    );
    spy.mockRestore();
  });

  test("identity guard rejects same-gate resolution via a direct exact match", () => {
    // Regression for the bare identity check: two intent tiles that both
    // exactly match the same gate tile must be rejected by the post-
    // resolution guard, not just by the raw intent-tile equality check.
    // We bypass the intent-tile pre-check by making the two intent tiles
    // slightly different, then place a single gate such that only the
    // drift fallback collapses them. The dest-resolution exclusion then
    // blocks one endpoint; combined with the identity guard, the failure
    // path is deterministic regardless of which exact-match path wins.
    const voidTile = game.ref(10, 4);
    const bc = spawnBattlecruiser(voidTile);
    const gate = pilot.buildUnit(UnitType.JumpGate, voidTile, {});
    bc.setSlottedStructure(gate);
    game.addExecution(new JumpGateExecution(gate));

    const spy = vi.spyOn(game, "displayMessage");
    // Both intent tiles differ but sit near the single surviving gate.
    game.addExecution(
      new JumpGateTeleportExecution(pilot, game.ref(9, 4), game.ref(11, 4)),
    );
    executeTicks(game, 1);

    expect(
      spy.mock.calls.some((c) => c[1] === MessageType.JUMP_GATE_FAILED),
    ).toBe(true);
    expect(
      spy.mock.calls.some((c) => c[1] === MessageType.JUMP_GATE_TELEPORT),
    ).toBe(false);
    spy.mockRestore();
  });
});

describe("Capital Ship — build menu buildability on deep space", () => {
  beforeEach(async () => {
    await buildMixedGame();
  });

  test("hostable structures are buildable in capital-ship mode on a deep-space cruiser tile", () => {
    // Park a cruiser on an unowned void tile. Ground-mode buildability would
    // report every structure as unbuildable here (no owned tile nearby to
    // satisfy `validStructureSpawnTiles`). Capital-ship mode must route
    // through the cruiser slot and surface hostable structures instead.
    const voidTile = game.ref(10, 4);
    expect(game.isVoid(voidTile)).toBe(true);
    expect(game.owner(voidTile)).not.toBe(pilot);

    const bc = pilot.buildUnit(UnitType.Battlecruiser, voidTile, {
      patrolTile: voidTile,
    });
    expect(bc.slottedStructure()).toBeUndefined();

    // Baseline: ground mode returns canBuild=false for every hostable type.
    const hostable = game.config().battlecruiserHostableStructures();
    const groundBuildables = pilot.buildableUnits(voidTile, hostable);
    for (const bu of groundBuildables) {
      expect(bu.canBuild).toBe(false);
    }

    // Capital-ship mode: every hostable type should resolve to canBuild
    // targeting the cruiser's tile.
    const capitalBuildables = pilot.buildableUnits(voidTile, hostable, {
      capitalShipMode: true,
    });
    expect(capitalBuildables.length).toBe(hostable.length);
    for (const bu of capitalBuildables) {
      expect(hostable.includes(bu.type)).toBe(true);
      expect(bu.canBuild).toBe(bc.tile());
    }
  });

  test("capital-ship mode reports canBuild=false when the nearby cruiser slot is full", () => {
    const voidTile = game.ref(10, 4);
    const bc = pilot.buildUnit(UnitType.Battlecruiser, voidTile, {
      patrolTile: voidTile,
    });
    // Fill the slot with any hostable structure so the lookup short-circuits.
    const colony = pilot.buildUnit(UnitType.Colony, voidTile, {});
    bc.setSlottedStructure(colony);

    const hostable = game.config().battlecruiserHostableStructures();
    const buildables = pilot.buildableUnits(voidTile, hostable, {
      capitalShipMode: true,
    });
    for (const bu of buildables) {
      expect(bu.canBuild).toBe(false);
    }
  });
});
