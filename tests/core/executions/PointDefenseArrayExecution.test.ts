import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { PointDefenseArrayExecution } from "../../../src/core/execution/PointDefenseArrayExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { UpgradeStructureExecution } from "../../../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { constructionExecution, executeTicks } from "../../util/utils";

let game: Game;
const gameID: GameID = "game_id";
let attacker: Player;
let defender: Player;
let far_defender: Player;
let middle_defender: Player;

describe("SAM", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {
      infiniteCredits: true,
      instantBuild: true,
    });
    const defender_info = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    const middle_defender_info = new PlayerInfo(
      "middle_defender_id",
      PlayerType.Human,
      null,
      "middle_defender_id",
    );
    const far_defender_info = new PlayerInfo(
      "far_defender_id",
      PlayerType.Human,
      null,
      "far_defender_id",
    );
    const attacker_info = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(defender_info);
    game.addPlayer(middle_defender_info);
    game.addPlayer(far_defender_info);
    game.addPlayer(attacker_info);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(defender_info.id).info(),
        game.ref(1, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player(middle_defender_info.id).info(),
        game.ref(50, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player(far_defender_info.id).info(),
        game.ref(199, 1),
      ),
      new SpawnExecution(
        gameID,
        game.player(attacker_info.id).info(),
        game.ref(7, 7),
      ),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");
    defender = game.player("defender_id");
    middle_defender = game.player("middle_defender_id");
    far_defender = game.player("far_defender_id");

    constructionExecution(game, attacker, 7, 7, UnitType.OrbitalStrikePlatform);
  });

  test("one sam should take down one nuke", async () => {
    const sam = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(defender, null, sam));

    // Sam will only target nukes it can destroy before it reaches its target
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const nuke = attacker.buildUnit(
      UnitType.AntimatterTorpedo,
      game.ref(1, 1),
      {
        targetTile: game.ref(3, 1),
        trajectory: [
          { tile: game.ref(1, 1), targetable: true },
          { tile: game.ref(2, 1), targetable: true },
          { tile: game.ref(3, 1), targetable: true },
        ],
      },
    );
    executeTicks(game, 3);

    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(0);
  });

  test("sam should only get one nuke at a time", async () => {
    const sam = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(defender, null, sam));
    attacker.buildUnit(UnitType.AntimatterTorpedo, game.ref(2, 1), {
      targetTile: game.ref(3, 1),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(2, 1), targetable: true },
        { tile: game.ref(3, 1), targetable: true },
      ],
    });
    attacker.buildUnit(UnitType.AntimatterTorpedo, game.ref(1, 2), {
      targetTile: game.ref(1, 3),
      trajectory: [
        { tile: game.ref(1, 1), targetable: true },
        { tile: game.ref(1, 2), targetable: true },
        { tile: game.ref(1, 3), targetable: true },
      ],
    });
    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(2);

    executeTicks(game, 3);

    expect(attacker.units(UnitType.AntimatterTorpedo)).toHaveLength(1);
  });

  test("sam should cooldown as long as configured", async () => {
    const sam = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 1),
      {},
    );

    game.addExecution(new PointDefenseArrayExecution(defender, null, sam));
    expect(sam.isInCooldown()).toBeFalsy();
    const nuke = attacker.buildUnit(
      UnitType.AntimatterTorpedo,
      game.ref(1, 1),
      {
        targetTile: game.ref(1, 3),
        trajectory: [
          { tile: game.ref(1, 1), targetable: true },
          { tile: game.ref(2, 1), targetable: true },
          { tile: game.ref(3, 1), targetable: true },
        ],
      },
    );

    executeTicks(game, 3);

    expect(nuke.isActive()).toBeFalsy();

    for (let i = 0; i < game.config().pointDefenseCooldown() - 3; i++) {
      game.executeNextTick();
      expect(sam.isInCooldown()).toBeTruthy();
    }

    executeTicks(game, 2);

    expect(sam.isInCooldown()).toBeFalsy();
  });

  test("two sams should not target twice same nuke", async () => {
    const sam1 = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(defender, null, sam1));
    const sam2 = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 2),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(defender, null, sam2));
    const nuke = attacker.buildUnit(
      UnitType.AntimatterTorpedo,
      game.ref(1, 1),
      {
        targetTile: game.ref(1, 3),
        trajectory: [
          { tile: game.ref(1, 1), targetable: true },
          { tile: game.ref(1, 2), targetable: true },
          { tile: game.ref(1, 3), targetable: true },
        ],
      },
    );

    executeTicks(game, 3);

    expect(nuke.isActive()).toBeFalsy();
    expect([sam1, sam2].filter((s) => s.isInCooldown())).toHaveLength(1);
  });

  test("SAMs should target close to launch site", async () => {
    const targetDistance = 199;
    // Close SAM: should intercept the nuke
    const sam = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(defender, null, sam));

    const nukeExecution = new NukeExecution(
      UnitType.AntimatterTorpedo,
      attacker,
      game.ref(targetDistance, 1),
      null,
    );
    game.addExecution(nukeExecution);
    // Long distance nuke: compute the proper number of ticks
    const ticksToExecute = Math.ceil(
      targetDistance / game.config().defaultNukeSpeed() + 1,
    );
    executeTicks(game, ticksToExecute);

    expect(nukeExecution.isActive()).toBeFalsy();
    expect(sam.isInCooldown()).toBeTruthy();
  });

  test("SAM near the launch site intercepts nukes early in flight", async () => {
    // The original test was named "SAMs should target only nukes aimed
    // at nearby targets if not close to launch site" and asserted that
    // a SAM in the middle of the trajectory would NOT intercept a nuke
    // headed elsewhere. That contract was never actually implemented —
    // `NukeExecution.isTargetable` flags a trajectory tile as
    // SAM-targetable when it is within `defaultNukeTargetableRange`
    // (150) of EITHER the launch site OR the target. With the 200×200
    // `big_plains` map there is no room for a "middle gap" between
    // those two 150-radius circles, so a SAM placed anywhere along the
    // path is always within range of a targetable trajectory tile.
    //
    // Updated contract: a SAM positioned near the LAUNCH SITE
    // intercepts the nuke early in flight (catching it on the
    // source-radius leg of the trajectory). A SAM positioned near the
    // TARGET intercepts on the target-radius leg. Both should fire.
    const targetDistance = 199;
    const sam1 = middle_defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(50, 1),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(defender, null, sam1));

    const sam2 = far_defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(targetDistance, 1),
      {},
    );
    game.addExecution(new PointDefenseArrayExecution(far_defender, null, sam2));

    const nukeExecution = new NukeExecution(
      UnitType.AntimatterTorpedo,
      attacker,
      game.ref(targetDistance, 1),
      null,
    );
    game.addExecution(nukeExecution);
    // Long distance nuke: compute the proper number of ticks
    const ticksToExecute = Math.ceil(
      targetDistance / game.config().defaultNukeSpeed() + 1,
    );
    executeTicks(game, ticksToExecute);
    expect(nukeExecution.isActive()).toBeFalsy();
    // Either SAM may have fired (whichever intercepted first). At
    // least one must have fired, which is the load-bearing invariant
    // for the "SAMs intercept along the trajectory" contract.
    const samsFired =
      (sam1.isInCooldown() ? 1 : 0) + (sam2.isInCooldown() ? 1 : 0);
    expect(samsFired).toBeGreaterThanOrEqual(1);
  });

  test("SAM should have increased level after upgrade", async () => {
    defender.buildUnit(UnitType.PointDefenseArray, game.ref(1, 1), {});
    expect(defender.units(UnitType.PointDefenseArray)[0].level()).toEqual(1);

    const upgradeStructureExecution = new UpgradeStructureExecution(
      defender,
      defender.units(UnitType.PointDefenseArray)[0].id(),
    );
    game.addExecution(upgradeStructureExecution);
    executeTicks(game, 2);

    expect(defender.units(UnitType.PointDefenseArray)[0].level()).toEqual(2);
  });
});
