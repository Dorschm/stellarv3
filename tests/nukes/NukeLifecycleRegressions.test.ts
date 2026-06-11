import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../src/core/execution/NukeExecution";
import { PointDefenseMissileExecution } from "../../src/core/execution/PointDefenseMissileExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

describe("Nuke lifecycle regressions", () => {
  let game: Game;
  let player: Player;
  const gameID: GameID = "game_id";

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    game.addPlayer(info);
    game.addExecution(new SpawnExecution(gameID, info, game.ref(1, 1)));
    while (game.inSpawnPhase()) game.executeNextTick();
    player = game.player(info.id);

    player.conquer(game.ref(1, 1));
  });

  test("nuking a Battlecruiser with a slotted structure does not abort the tick", () => {
    // A Battlecruiser hosting a structure shares its tile with the hosted
    // unit. UnitImpl.delete cascade-deletes the slotted structure, so the
    // detonation loop must not call delete() on the (now inactive) structure
    // entry a second time — that throw used to abort the entire game tick.
    const dst = game.ref(50, 50);
    player.conquer(dst);
    const cruiser = player.buildUnit(UnitType.Battlecruiser, dst, {
      patrolTile: dst,
    });
    const station = player.buildUnit(UnitType.DefenseStation, dst, {});
    cruiser.setSlottedStructure(station);

    // Submunition-style nuke: spawns directly at src and flies to dst.
    game.addExecution(
      new NukeExecution(
        UnitType.ClusterWarheadSubmunition,
        player,
        dst,
        game.ref(45, 45),
      ),
    );

    // Without the isActive() guard in detonate() this throws
    // "cannot delete ... not active" out of executeNextTick.
    for (
      let i = 0;
      i < 100 && (cruiser.isActive() || station.isActive());
      i++
    ) {
      game.executeNextTick();
    }

    expect(cruiser.isActive()).toBe(false);
    expect(station.isActive()).toBe(false);
  });

  test("destroyed point-defense missile clears targetedByPointDefense on the nuke", () => {
    const defenderInfo = new PlayerInfo("d", PlayerType.Human, null, "d");
    game.addPlayer(defenderInfo);
    const defender = game.player(defenderInfo.id);

    const nuke = player.buildUnit(
      UnitType.AntimatterTorpedo,
      game.ref(80, 80),
      {
        targetTile: game.ref(90, 90),
        trajectory: [],
      },
    );
    // Simulate a PDA acquiring the nuke (PointDefenseArrayExecution does this
    // right before adding the missile execution).
    nuke.setTargetedByPointDefense(true);

    const pda = defender.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(1, 5),
      {},
    );
    const exec = new PointDefenseMissileExecution(
      game.ref(1, 5),
      defender,
      pda,
      nuke,
      game.ref(80, 80),
    );
    game.addExecution(exec);
    game.executeNextTick(); // init
    game.executeNextTick(); // builds the SAM missile, starts flying

    const sam = defender.units(UnitType.PointDefenseMissile)[0];
    expect(sam).toBeDefined();
    expect(sam.isActive()).toBe(true);

    // Destroy the interceptor externally (e.g. its owner was eliminated and
    // PlayerExecution.removeOnDeath deleted it mid-flight).
    sam.delete(false);
    game.executeNextTick(); // execution hits the missile-destroyed branch

    expect(exec.isActive()).toBe(false);
    expect(nuke.isActive()).toBe(true);
    // The flag must be cleared so other PDAs can re-acquire the nuke.
    expect(nuke.targetedByPointDefense()).toBe(false);
  });

  test("ClusterWarhead launch puts the Orbital Strike Platform on cooldown", () => {
    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.OrbitalStrikePlatform,
        game.ref(1, 1),
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    const platforms = player.units(UnitType.OrbitalStrikePlatform);
    expect(platforms).toHaveLength(1);
    const platform = platforms[0];
    expect(platform.isInCooldown()).toBe(false);

    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.ClusterWarhead,
        game.ref(1, 1),
      ),
    );
    // Tick until the MIRV warhead unit is built (same tick as the launch).
    for (
      let i = 0;
      i < 10 && player.units(UnitType.ClusterWarhead).length === 0;
      i++
    ) {
      game.executeNextTick();
    }
    expect(player.units(UnitType.ClusterWarhead)).toHaveLength(1);

    // Mirrors the regular nuke launch path: the launch consumes a missile
    // slot and starts the orbital strike cooldown.
    expect(platform.isInCooldown()).toBe(true);
  });
});
