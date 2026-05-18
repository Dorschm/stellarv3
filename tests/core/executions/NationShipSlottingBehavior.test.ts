// @vitest-environment node
import { vi } from "vitest";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { NationShipSlottingBehavior } from "../../../src/core/execution/nation/NationShipSlottingBehavior";
import { NationExecution } from "../../../src/core/execution/NationExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Cell,
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

/**
 * Focused coverage for `NationShipSlottingBehavior` — the nation-AI module
 * that fills empty Battlecruiser slots with a Colony or OrbitalStrikePlatform.
 * These tests pin the new ticket-specific decision logic (difficulty gates,
 * Colony-vs-OSP selection, spawn-phase short-circuit) and the disabled /
 * non-hostable / insufficient-credit / occupied-slot guard paths, plus the
 * `NationExecution` integration point that drives the behavior each cadence.
 *
 * Sibling lower-level tests (`HostOnlyConstruction.test.ts`,
 * `Battlecruiser.test.ts`) already cover the host-only `ConstructionExecution`
 * mechanics and colony-claim wake; this file exercises the nation-level
 * behavior layered on top of them.
 */

const gameID: GameID = "nation_ship_slotting_game";

let game: Game;
let nationPlayer: Player;

/**
 * Build a game with a single Nation-type player. By default the player is
 * spawned and the spawn phase is drained so the behavior's
 * `inSpawnPhase()` short-circuit no longer applies.
 */
async function buildGame(
  opts: {
    difficulty?: Difficulty;
    infiniteCredits?: boolean;
    drainSpawnPhase?: boolean;
  } = {},
): Promise<void> {
  game = await setup("big_plains", {
    difficulty: opts.difficulty ?? Difficulty.Medium,
    infiniteCredits: opts.infiniteCredits ?? true,
    instantBuild: true,
  });
  game.addPlayer(
    new PlayerInfo(
      "nation alpha",
      PlayerType.Nation,
      "nation-client",
      "nation",
    ),
  );
  if (opts.drainSpawnPhase ?? true) {
    game.addExecution(
      new SpawnExecution(gameID, game.player("nation").info(), game.ref(5, 5)),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  }
  nationPlayer = game.player("nation");
  // The `infiniteCredits` flag only makes spending free — `credits()` still
  // reads 0 until topped up, and `buildUnit` deducts unit cost. Seed a
  // comfortable balance so the behavior's credit guard is satisfied by
  // default; the insufficient-credit test drains it back to 0.
  nationPlayer.addCredits(5_000_000n);
}

/** Owned, active, fully-built Battlecruiser with an empty slot. */
function spawnCruiser(tile = game.ref(5, 5)): Unit {
  return nationPlayer.buildUnit(UnitType.Battlecruiser, tile, {
    patrolTile: tile,
  });
}

/**
 * A `PseudoRandom` whose `nextInt` always returns 0. That makes the
 * difficulty probability gate always pass (`0 >= threshold` is false) and
 * the Colony-vs-OSP weighted split always resolve to Colony when the
 * cruiser is Colony-eligible — keeping the tests deterministic.
 */
function makeRandom(): PseudoRandom {
  const random = new PseudoRandom(0);
  vi.spyOn(random, "nextInt").mockReturnValue(0);
  return random;
}

function makeBehavior(
  random: PseudoRandom = makeRandom(),
): NationShipSlottingBehavior {
  return new NationShipSlottingBehavior(random, game, nationPlayer);
}

/** The `ConstructionExecution`s passed to `game.addExecution` via the spy. */
function dispatchedConstructions(
  spy: ReturnType<typeof vi.spyOn>,
): ConstructionExecution[] {
  return spy.mock.calls
    .map((call) => call[0])
    .filter(
      (exec): exec is ConstructionExecution =>
        exec instanceof ConstructionExecution,
    );
}

/** Read the private host-only fields off a dispatched ConstructionExecution. */
function constructionFields(exec: ConstructionExecution): {
  constructionType: UnitType;
  hostBattlecruiserId?: number;
} {
  return exec as unknown as {
    constructionType: UnitType;
    hostBattlecruiserId?: number;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NationShipSlottingBehavior — slot type selection", () => {
  test("Easy difficulty always slots a Colony via the host-only path", async () => {
    await buildGame({ difficulty: Difficulty.Easy });
    const cruiser = spawnCruiser();
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(true);

    const constructions = dispatchedConstructions(addExecSpy);
    expect(constructions).toHaveLength(1);
    const fields = constructionFields(constructions[0]);
    expect(fields.constructionType).toBe(UnitType.Colony);
    // Host-only contract: the construction targets the cruiser by id, not
    // a ground tile — proving it is not a ground-placement build.
    expect(fields.hostBattlecruiserId).toBe(cruiser.id());

    executeTicks(game, 4);
    expect(cruiser.slottedStructure()?.type()).toBe(UnitType.Colony);
  });

  test("non-Colony-eligible cruiser slots an OrbitalStrikePlatform", async () => {
    await buildGame({ difficulty: Difficulty.Medium });
    const cruiser = spawnCruiser();
    // Cruiser sits on a sector tile, so it is NOT in deep space and cannot
    // be Colony-eligible — the behavior must fall back to an OSP.
    expect(game.isDeepSpace(cruiser.tile())).toBe(false);
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(true);

    const constructions = dispatchedConstructions(addExecSpy);
    expect(constructions).toHaveLength(1);
    const fields = constructionFields(constructions[0]);
    expect(fields.constructionType).toBe(UnitType.OrbitalStrikePlatform);
    expect(fields.hostBattlecruiserId).toBe(cruiser.id());

    executeTicks(game, 4);
    expect(cruiser.slottedStructure()?.type()).toBe(
      UnitType.OrbitalStrikePlatform,
    );
  });

  test("Medium falls back to Colony when the preferred OSP is unavailable", async () => {
    await buildGame({ difficulty: Difficulty.Medium });
    const cruiser = spawnCruiser();
    // Cruiser sits on a sector tile, so it is not Colony-eligible — the
    // preferred slot type for Medium is therefore OrbitalStrikePlatform.
    expect(game.isDeepSpace(cruiser.tile())).toBe(false);
    // Disable exactly that preferred type. The behavior must not strand the
    // slot: it should evaluate the alternate hostable structure (Colony).
    game.config().isUnitDisabled = (unit: UnitType) =>
      unit === UnitType.OrbitalStrikePlatform;
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(true);

    const constructions = dispatchedConstructions(addExecSpy);
    expect(constructions).toHaveLength(1);
    const fields = constructionFields(constructions[0]);
    expect(fields.constructionType).toBe(UnitType.Colony);
    expect(fields.hostBattlecruiserId).toBe(cruiser.id());

    executeTicks(game, 4);
    expect(cruiser.slottedStructure()?.type()).toBe(UnitType.Colony);
  });

  test("Impossible balances cruiser slots from hosted structures, not ground Colonies", async () => {
    await buildGame({ difficulty: Difficulty.Impossible });
    // Many ordinary ground Colonies built by normal expansion. These must
    // NOT skew the contextual tie-break, which should only weigh
    // Battlecruiser-hosted structures.
    for (let i = 0; i < 6; i++) {
      nationPlayer.buildUnit(UnitType.Colony, game.ref(10 + i, 10), {});
    }
    const cruiser = spawnCruiser();
    // Building those ground Colonies escalates Colony cost and drains the
    // starting balance — top up so the credit guard is not what's tested.
    nationPlayer.addCredits(50_000_000n);
    // Make the cruiser Colony-eligible regardless of the map's terrain.
    vi.spyOn(game, "isDeepSpace").mockReturnValue(true);
    vi.spyOn(game, "circleSearch").mockReturnValue(new Set([game.ref(6, 6)]));
    // No structures are hosted on cruisers yet, so the fleet-local Colony
    // and OSP counts are equal and the tie-break resolves via `chance`.
    // Pin it to Colony; with the old empire-wide count the 6 ground
    // Colonies would instead force OrbitalStrikePlatform.
    const random = makeRandom();
    vi.spyOn(random, "chance").mockReturnValue(true);
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior(random).maybeSlotStructureOnEmptyCruiser()).toBe(true);

    const constructions = dispatchedConstructions(addExecSpy);
    expect(constructions).toHaveLength(1);
    const fields = constructionFields(constructions[0]);
    expect(fields.constructionType).toBe(UnitType.Colony);
    expect(fields.hostBattlecruiserId).toBe(cruiser.id());
  });
});

describe("NationShipSlottingBehavior — guard paths", () => {
  test("short-circuits during the spawn phase without dispatching", async () => {
    await buildGame({ drainSpawnPhase: false });
    expect(game.inSpawnPhase()).toBe(true);
    // Even with a perfectly slottable cruiser present, the spawn-phase
    // guard must bail before any candidate search.
    spawnCruiser();
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(false);
    expect(dispatchedConstructions(addExecSpy)).toHaveLength(0);
  });

  test("does not dispatch when the chosen structure type is disabled", async () => {
    await buildGame({ difficulty: Difficulty.Easy });
    const cruiser = spawnCruiser();
    // Easy always chooses Colony — disable exactly that type.
    game.config().isUnitDisabled = (unit: UnitType) => unit === UnitType.Colony;
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(false);
    expect(dispatchedConstructions(addExecSpy)).toHaveLength(0);
    expect(cruiser.slottedStructure()).toBeUndefined();
  });

  test("does not dispatch when the chosen structure type is not hostable", async () => {
    await buildGame({ difficulty: Difficulty.Easy });
    const cruiser = spawnCruiser();
    // No structure is hostable — the host-only guard must reject.
    game.config().battlecruiserHostableStructures = () => [];
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(false);
    expect(dispatchedConstructions(addExecSpy)).toHaveLength(0);
    expect(cruiser.slottedStructure()).toBeUndefined();
  });

  test("does not dispatch when the nation cannot afford the structure", async () => {
    await buildGame({ difficulty: Difficulty.Easy, infiniteCredits: false });
    const cruiser = spawnCruiser();
    nationPlayer.removeCredits(nationPlayer.credits());
    expect(nationPlayer.credits()).toBe(0n);
    // Sanity: the structure the behavior would slot actually costs credits,
    // so the credit guard is genuinely exercised.
    expect(
      game.unitInfo(UnitType.Colony).cost(game, nationPlayer),
    ).toBeGreaterThan(0n);
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(false);
    expect(dispatchedConstructions(addExecSpy)).toHaveLength(0);
    expect(cruiser.slottedStructure()).toBeUndefined();
  });

  test("does not dispatch when the only cruiser already has an occupied slot", async () => {
    await buildGame({ difficulty: Difficulty.Easy });
    const cruiser = spawnCruiser();
    const occupant = nationPlayer.buildUnit(
      UnitType.DefenseStation,
      cruiser.tile(),
      {},
    );
    cruiser.setSlottedStructure(occupant);
    const addExecSpy = vi.spyOn(game, "addExecution");

    expect(makeBehavior().maybeSlotStructureOnEmptyCruiser()).toBe(false);
    expect(dispatchedConstructions(addExecSpy)).toHaveLength(0);
    // The pre-existing occupant is untouched.
    expect(cruiser.slottedStructure()).toBe(occupant);
  });
});

describe("NationShipSlottingBehavior — NationExecution integration", () => {
  test("NationExecution drives the ship-slotting behavior on attack ticks", async () => {
    const slotSpy = vi.spyOn(
      NationShipSlottingBehavior.prototype,
      "maybeSlotStructureOnEmptyCruiser",
    );

    game = await setup("big_plains", { instantBuild: true });
    const nation = new Nation(
      new Cell(100, 100),
      new PlayerInfo("nation beta", PlayerType.Nation, null, "nation-beta"),
    );
    game.addExecution(new NationExecution(gameID, nation));

    // Drive past the spawn phase (100 turns for singleplayer) and through a
    // full attack cadence (attackRate <= 80) so at least one attack tick
    // fires after the behaviors are initialized.
    executeTicks(game, 240);

    // The nation spawned, stayed alive, and its tick loop invoked the
    // wired-up ship-slotting behavior.
    expect(game.hasPlayer("nation-beta")).toBe(true);
    expect(game.player("nation-beta").isAlive()).toBe(true);
    expect(slotSpy).toHaveBeenCalled();
  });
});
