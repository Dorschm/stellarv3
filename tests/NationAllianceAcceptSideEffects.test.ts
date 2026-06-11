import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Relation,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

let game: Game;
let human: Player;
let nation: Player;
let allianceBehavior: NationAllianceBehavior;

// A nation accepting an alliance request must run the same side effects as a
// human acceptance (which goes through AllianceRequestExecution's auto-accept
// branch): mutual +100 relation, temporary-embargo cleanup, and destroying
// in-flight nukes between the new allies.
describe("Nation alliance acceptance side effects", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteCredits: true,
        instantBuild: true,
        infinitePopulation: true,
      },
      [
        new PlayerInfo("human", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("nation", PlayerType.Nation, null, "p2"),
      ],
    );

    (game.config() as TestConfig).nukeAllianceBreakThreshold = () => 0;

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    // Tick past the nation's spawn-phase cutoff: requests created at
    // createdAt <= numSpawnPhaseTurns + 1 are auto-rejected.
    game.executeNextTick();
    game.executeNextTick();

    human = game.player("p1");
    nation = game.player("p2");

    human.conquer(game.ref(0, 0));
    nation.conquer(game.ref(5, 5));

    const random = new PseudoRandom(42);
    allianceBehavior = new NationAllianceBehavior(
      random,
      game,
      nation,
      new NationEmojiBehavior(random, game, nation),
    );
  });

  function nationAcceptsPendingRequest() {
    // Force the (probabilistic) decision so the test exercises the
    // acceptance plumbing, not the decision logic.
    vi.spyOn(allianceBehavior as any, "getAllianceDecision").mockReturnValue(
      true,
    );
    allianceBehavior.handleAllianceRequests();
    game.executeNextTick(); // reciprocal request inits and auto-accepts
  }

  test("acceptance boosts relations and clears temporary embargoes both ways", () => {
    nation.addEmbargo(human, true);
    human.addEmbargo(nation, true);
    expect(nation.hasEmbargoAgainst(human)).toBe(true);
    expect(human.hasEmbargoAgainst(nation)).toBe(true);

    game.addExecution(new AllianceRequestExecution(human, nation.id()));
    game.executeNextTick(); // creates the pending request

    nationAcceptsPendingRequest();

    expect(nation.isAlliedWith(human)).toBe(true);
    expect(nation.relation(human)).toBe(Relation.Friendly);
    expect(human.relation(nation)).toBe(Relation.Friendly);
    expect(nation.hasEmbargoAgainst(human)).toBe(false);
    expect(human.hasEmbargoAgainst(nation)).toBe(false);
  });

  test("acceptance destroys in-flight nukes between the new allies", () => {
    human.buildUnit(UnitType.OrbitalStrikePlatform, game.ref(0, 0), {});
    game.addExecution(
      new NukeExecution(
        UnitType.AntimatterTorpedo,
        human,
        game.ref(5, 5),
        game.ref(0, 0),
        -1,
        5,
      ),
    );
    game.executeNextTick(); // init
    game.executeNextTick(); // spawn nuke
    expect(game.units(UnitType.AntimatterTorpedo)).toHaveLength(1);

    game.addExecution(new AllianceRequestExecution(human, nation.id()));
    game.executeNextTick(); // creates the pending request

    nationAcceptsPendingRequest();

    expect(nation.isAlliedWith(human)).toBe(true);
    expect(game.units(UnitType.AntimatterTorpedo)).toHaveLength(0);
  });
});
