// @vitest-environment node
import { vi } from "vitest";
import { BattlecruiserExecution } from "../../../src/core/execution/BattlecruiserExecution";
import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { Executor } from "../../../src/core/execution/ExecutionManager";
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
import { GameID, StampedIntent } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

/**
 * Issue #7 regression — host-only `ConstructionExecution` path used by the
 * capital-ship hotkey flow. When a Battlecruiser is selected and the player
 * presses a structure hotkey, the client sends `hostBattlecruiserId` along
 * with the intent. The server must:
 *   - host the structure on that exact cruiser if its slot is empty, OR
 *   - deactivate without falling back to ground placement otherwise.
 *
 * Without the host-only contract a full-slot cruiser could silently produce
 * an unintended ground structure on the cruiser's current tile (or charge
 * credits for a build that goes nowhere).
 */

const gameID: GameID = "host_only_game";

let game: Game;
let pilot: Player;

async function buildGame(opts: { infiniteCredits: boolean }) {
  game = await setup("big_plains", {
    infiniteCredits: opts.infiniteCredits,
    instantBuild: true,
  });
  // Give the pilot a clientID so the Executor regression test below can
  // resolve `intent.clientID` back to a player via `playerByClientID`.
  game.addPlayer(
    new PlayerInfo("pilot", PlayerType.Human, "pilot-client", "pilot"),
  );
  game.addExecution(
    new SpawnExecution(gameID, game.player("pilot").info(), game.ref(5, 5)),
  );
  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }
  pilot = game.player("pilot");
}

function spawnBattlecruiser(patrolTile = game.ref(5, 5)): Unit {
  const bc = pilot.buildUnit(UnitType.Battlecruiser, patrolTile, {
    patrolTile,
  });
  game.addExecution(new BattlecruiserExecution(bc));
  return bc;
}

describe("ConstructionExecution — host-only hotkey path", () => {
  test("hosts structure on the named cruiser when slot is empty", async () => {
    await buildGame({ infiniteCredits: true });
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);
    expect(bc.slottedStructure()).toBeUndefined();

    // Use a distant target tile to prove host-only ignores the tile and
    // homes in on the cruiser by id instead.
    game.addExecution(
      new ConstructionExecution(
        pilot,
        UnitType.DefenseStation,
        game.ref(50, 50),
        undefined,
        bc.id(),
      ),
    );
    executeTicks(game, 4);

    expect(bc.slottedStructure()?.type()).toBe(UnitType.DefenseStation);
  });

  test("rejects without ground fallback when slot is occupied", async () => {
    await buildGame({ infiniteCredits: true });
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);
    const occupant = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(occupant);

    const dsCountBefore = pilot.units(UnitType.DefenseStation).length;
    game.addExecution(
      new ConstructionExecution(
        pilot,
        UnitType.DefenseStation,
        patrolTile,
        undefined,
        bc.id(),
      ),
    );
    executeTicks(game, 4);

    // Slot still hosts the original occupant; no extra structure was built
    // anywhere (the host-only path must not fall back to ground placement).
    expect(bc.slottedStructure()).toBe(occupant);
    expect(pilot.units(UnitType.DefenseStation).length).toBe(dsCountBefore);
  });

  test("rejects when caller cannot afford the host cost", async () => {
    await buildGame({ infiniteCredits: false });
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    // Drain the player's credits so the host cost check fails. The slot
    // must remain empty and no ground structure may be built.
    pilot.removeCredits(pilot.credits());
    expect(pilot.credits()).toBe(0n);

    // Spy on displayMessage to verify the player gets visible feedback
    // (events panel), not just a silent console.warn.
    const displayMessageSpy = vi.spyOn(game, "displayMessage");

    const dsCountBefore = pilot.units(UnitType.DefenseStation).length;
    game.addExecution(
      new ConstructionExecution(
        pilot,
        UnitType.DefenseStation,
        patrolTile,
        undefined,
        bc.id(),
      ),
    );
    executeTicks(game, 4);

    expect(bc.slottedStructure()).toBeUndefined();
    expect(pilot.units(UnitType.DefenseStation).length).toBe(dsCountBefore);

    expect(displayMessageSpy).toHaveBeenCalledWith(
      "events_display.host_build_rejected",
      MessageType.HOST_BUILD_REJECTED,
      pilot.id(),
      undefined,
      expect.objectContaining({ reason: expect.any(String) }),
    );

    displayMessageSpy.mockRestore();
  });

  test("rejects when the named cruiser no longer exists", async () => {
    await buildGame({ infiniteCredits: true });
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);
    const cruiserId = bc.id();
    bc.delete();

    const dsCountBefore = pilot.units(UnitType.DefenseStation).length;
    game.addExecution(
      new ConstructionExecution(
        pilot,
        UnitType.DefenseStation,
        patrolTile,
        undefined,
        cruiserId,
      ),
    );
    executeTicks(game, 4);

    expect(pilot.units(UnitType.DefenseStation).length).toBe(dsCountBefore);
  });

  test("server-intent regression: plain build_unit (no hostBattlecruiserId) does NOT host on a nearby cruiser", async () => {
    await buildGame({ infiniteCredits: true });
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);
    expect(bc.slottedStructure()).toBeUndefined();

    // Build the same `build_unit` intent the Transport layer would ship,
    // omitting `hostBattlecruiserId` to simulate an ordinary ground build
    // (the client's normal BuildMenu path without the capital-ship hotkey).
    // The Executor must turn this into a plain `ConstructionExecution`
    // that ignores the cruiser entirely — no proximity fallback.
    const executor = new Executor(game, gameID, "pilot-client");
    const intent: StampedIntent = {
      type: "build_unit",
      unit: UnitType.DefenseStation,
      tile: patrolTile,
      clientID: "pilot-client",
    } as StampedIntent;
    game.addExecution(executor.createExec(intent));
    executeTicks(game, 4);

    expect(bc.slottedStructure()).toBeUndefined();
  });

  test("exposes slot occupancy in the UnitUpdate snapshot", async () => {
    await buildGame({ infiniteCredits: true });
    const patrolTile = game.ref(5, 5);
    const bc = spawnBattlecruiser(patrolTile);

    expect(bc.toUpdate().hasSlottedStructure).toBe(false);

    const ds = pilot.buildUnit(UnitType.DefenseStation, patrolTile, {});
    bc.setSlottedStructure(ds);
    expect(bc.toUpdate().hasSlottedStructure).toBe(true);
  });
});
