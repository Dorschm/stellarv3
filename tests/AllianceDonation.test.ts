import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { DonateCreditsExecution } from "../src/core/execution/DonateCreditsExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

describe("Alliance Donation", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteCredits: false,
        instantBuild: true,
        infinitePopulation: false,
        donateCredits: true,
        donatePopulation: true,
      },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
      ],
    );

    player1 = game.player("player1");
    player1.conquer(game.ref(0, 0));
    player1.addCredits(1000n);
    player1.addPopulation(1000);

    player2 = game.player("player2");
    player2.conquer(game.ref(0, 1));
    player2.addCredits(100n);
    player2.addPopulation(100);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("Can donate gold after alliance formed by reply", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
    expect(player1.isFriendly(player2)).toBeTruthy();
    expect(player2.isFriendly(player1)).toBeTruthy();

    expect(player1.canDonateCredits(player2)).toBeTruthy();
    const goldBefore = player2.credits();
    const success = player1.donateCredits(player2, 100n);
    expect(success).toBeTruthy();
    expect(player2.credits()).toBe(goldBefore + 100n);
  });

  test("Can donate population after alliance formed by reply", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    expect(player1.canDonatePopulation(player2)).toBeTruthy();
    const populationBefore = player2.population();
    const success = player1.donatePopulation(player2, 100);
    expect(success).toBeTruthy();
    expect(player2.population()).toBe(populationBefore + 100);
  });

  test("Can donate gold after alliance formed by mutual request", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
    expect(player1.isFriendly(player2)).toBeTruthy();
    expect(player2.isFriendly(player1)).toBeTruthy();

    expect(player1.canDonateCredits(player2)).toBeTruthy();
    const goldBefore = player2.credits();
    const success = player1.donateCredits(player2, 100n);
    expect(success).toBeTruthy();
    expect(player2.credits()).toBe(goldBefore + 100n);
  });

  test("Can donate population after alliance formed by mutual request", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    expect(player1.canDonatePopulation(player2)).toBeTruthy();
    const populationBefore = player2.population();
    const success = player1.donatePopulation(player2, 100);
    expect(success).toBeTruthy();
    expect(player2.population()).toBe(populationBefore + 100);
  });

  test("Can donate immediately after accepting alliance (race condition)", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    const goldBefore = player2.credits();
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.addExecution(new DonateCreditsExecution(player1, player2.id(), 100));

    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    game.executeNextTick();

    // Donation should have succeeded
    expect(player2.credits()).toBe(goldBefore + 100n);
  });
});
