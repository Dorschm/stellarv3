import { DonateCreditsExecution } from "../src/core/execution/DonateCreditsExecution";
import { DonatePopulationExecution } from "../src/core/execution/DonatePopulationExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

describe("Donate population to an ally", () => {
  it("Population should be successfully donated", async () => {
    const gameID: GameID = "game_id";
    const game = await setup("ocean_and_land", {
      infinitePopulation: false,
      donatePopulation: true,
    });

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, donorInfo, spawnA),
      new SpawnExecution(gameID, recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // donor sends alliance request to recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // recipient accepts the alliance request
    if (allianceRequest) {
      allianceRequest.accept();
    }

    // Ensure donor can actually donate the requested amount
    donor.addPopulation(6000);
    const donorPopulationBefore = donor.population();
    const recipientPopulationBefore = recipient.population();
    game.addExecution(
      new DonatePopulationExecution(donor, recipientInfo.id, 5000),
    );

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(donor.population() < donorPopulationBefore).toBe(true);
    expect(recipient.population() > recipientPopulationBefore).toBe(true);
  });
});

describe("Donate gold to an ally", () => {
  it("Gold should be successfully donated", async () => {
    const game = await setup("ocean_and_land", {
      infiniteCredits: false,
      donateCredits: true,
    });
    const gameID: GameID = "game_id";

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, donorInfo, spawnA),
      new SpawnExecution(gameID, recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // donor sends alliance request to recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // recipient accepts the alliance request
    if (allianceRequest) {
      allianceRequest.accept();
    }
    game.executeNextTick();

    // Ensure donor can actually donate the requested amount
    donor.addCredits(6000n);
    const donorGoldBefore = donor.credits();
    const recipientGoldBefore = recipient.credits();
    game.addExecution(
      new DonateCreditsExecution(donor, recipientInfo.id, 5000),
    );

    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(donor.credits() < donorGoldBefore).toBe(true);
    expect(recipient.credits() > recipientGoldBefore).toBe(true);
  });
});

describe("Donate population to a non ally", () => {
  it("Population should not be donated", async () => {
    const game = await setup("ocean_and_land", {
      infinitePopulation: false,
      donatePopulation: true,
    });
    const gameID: GameID = "game_id";

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, donorInfo, spawnA),
      new SpawnExecution(gameID, recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Donor sends alliance request to Recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // Donor rejects the Recipient
    if (allianceRequest) {
      allianceRequest.reject();
    }

    const donorPopulationBefore = donor.population();
    const recipientPopulationBefore = recipient.population();

    game.addExecution(
      new DonatePopulationExecution(donor, recipientInfo.id, 5000),
    );
    game.executeNextTick();

    // Population should not be donated since they are not allies
    expect(donor.population() >= donorPopulationBefore).toBe(true);
    expect(recipient.population() >= recipientPopulationBefore).toBe(true);
  });
});

describe("Donate Gold to a non ally", () => {
  it("Gold should not be donated", async () => {
    const game = await setup("ocean_and_land", {
      infiniteCredits: false,
      donateCredits: true,
    });
    const gameID: GameID = "game_id";

    const donorInfo = new PlayerInfo(
      "donor",
      PlayerType.Human,
      null,
      "donor_id",
    );
    const recipientInfo = new PlayerInfo(
      "recipient",
      PlayerType.Human,
      null,
      "recipient_id",
    );

    game.addPlayer(donorInfo);
    game.addPlayer(recipientInfo);

    const donor = game.player(donorInfo.id);
    const recipient = game.player(recipientInfo.id);

    // Spawn both players
    const spawnA = game.ref(0, 10);
    const spawnB = game.ref(0, 15);

    game.addExecution(
      new SpawnExecution(gameID, donorInfo, spawnA),
      new SpawnExecution(gameID, recipientInfo, spawnB),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Donor sends alliance request to Recipient
    const allianceRequest = donor.createAllianceRequest(recipient);
    expect(allianceRequest).not.toBeNull();

    // Donor rejects the Recipient
    if (allianceRequest) {
      allianceRequest.reject();
    }

    const donorGoldBefore = donor.credits();
    const recipientGoldBefore = donor.credits();

    game.addExecution(
      new DonateCreditsExecution(donor, recipientInfo.id, 5000),
    );
    game.executeNextTick();

    // Gold should not be donated since they are not allies
    expect(donor.credits() >= donorGoldBefore).toBe(true);
    expect(recipient.credits() >= recipientGoldBefore).toBe(true);
  });
});
