// @vitest-environment node
import { BattlecruiserExecution } from "../src/core/execution/BattlecruiserExecution";
import { MoveBattlecruiserExecution } from "../src/core/execution/MoveBattlecruiserExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

/**
 * Slot a Colony on the given Battlecruiser so its territorial-wake gate
 * (plans/here-is-a-list-twinkly-dragonfly.md §5.3) passes. The Colony is
 * built at the cruiser's current tile and immediately attached; the
 * cruiser's own `syncSlottedStructure` then keeps the Colony glued to
 * the cruiser as it patrols.
 */
function slotColonyOn(bc: Unit, owner: Player): Unit {
  const colony = owner.buildUnit(UnitType.Colony, bc.tile(), {});
  bc.setSlottedStructure(colony);
  return colony;
}

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Battlecruiser", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteCredits: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("pilot alpha", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("pilot alpha", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Battlecruiser heals only if player has spaceport", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Battlecruiser).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    const port = player1.buildUnit(
      UnitType.Spaceport,
      game.ref(coastX, 10),
      {},
    );
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    game.executeNextTick();

    expect(battlecruiser.health()).toBe(maxHealth);
    battlecruiser.modifyHealth(-10);
    expect(battlecruiser.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(battlecruiser.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(battlecruiser.health()).toBe(maxHealth - 9);
  });

  test("Battlecruiser captures trade if player has spaceport", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Spaceport, portTile, {});
    game.addExecution(
      new BattlecruiserExecution(
        player1.buildUnit(UnitType.Battlecruiser, portTile, {
          patrolTile: portTile,
        }),
      ),
    );

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 7),
      {
        targetUnit: player2.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 10),
          {},
        ),
      },
    );

    expect(tradeFreighter.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeFreighter.owner()).toBe(player1);
  });

  test("Battlecruiser do not capture trade if player has no spaceport", async () => {
    game.addExecution(
      new BattlecruiserExecution(
        player1.buildUnit(UnitType.Battlecruiser, game.ref(coastX + 1, 11), {
          patrolTile: game.ref(coastX + 1, 11),
        }),
      ),
    );

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 11),
      {
        targetUnit: player1.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 11),
          {},
        ),
      },
    );

    expect(tradeFreighter.owner().id()).toBe(player2.id());
    // Let plenty of time for battlecruiser to potentially capture trade freighter
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(tradeFreighter.owner().id()).toBe(player2.id());
  });

  test("Battlecruiser does not target trade freighters that are safe from pirates", async () => {
    // build port so battlecruiser can target trade freighters
    player1.buildUnit(UnitType.Spaceport, game.ref(coastX, 10), {});

    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 10),
      {
        targetUnit: player2.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 10),
          {},
        ),
      },
    );

    tradeFreighter.setSafeFromRaiders();

    executeTicks(game, 10);

    expect(tradeFreighter.owner().id()).toBe(player2.id());
  });

  test("Battlecruiser moves to new patrol tile", async () => {
    game.config().battlecruiserTargettingRange = () => 1;

    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new BattlecruiserExecution(battlecruiser));

    game.addExecution(
      new MoveBattlecruiserExecution(
        player1,
        battlecruiser.id(),
        game.ref(coastX + 5, 15),
      ),
    );

    executeTicks(game, 10);

    expect(battlecruiser.patrolTile()).toBe(game.ref(coastX + 5, 15));
  });

  test("Battlecruiser does not not target trade freighters outside of patrol range", async () => {
    game.config().battlecruiserTargettingRange = () => 3;

    // build port so battlecruiser can target trade freighters
    player1.buildUnit(UnitType.Spaceport, game.ref(coastX, 10), {});

    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    const tradeFreighter = player2.buildUnit(
      UnitType.TradeFreighter,
      game.ref(coastX + 1, 15),
      {
        targetUnit: player2.buildUnit(
          UnitType.Spaceport,
          game.ref(coastX, 10),
          {},
        ),
      },
    );

    executeTicks(game, 10);

    // Trade ship should not be captured
    expect(tradeFreighter.owner().id()).toBe(player2.id());
  });

  test("MoveBattlecruiserExecution fails if player is not the owner", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    new MoveBattlecruiserExecution(
      player2,
      battlecruiser.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(battlecruiser.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveBattlecruiserExecution fails if battlecruiser is not active", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    battlecruiser.delete();
    new MoveBattlecruiserExecution(
      player1,
      battlecruiser.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(battlecruiser.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveBattlecruiserExecution fails gracefully if battlecruiser not found", async () => {
    const exec = new MoveBattlecruiserExecution(
      player1,
      123,
      game.ref(coastX + 5, 15),
    );

    // Verify that no error is thrown.
    exec.init(game, 0);

    expect(exec.isActive()).toBe(false);
  });
});

describe("Battlecruiser — upkeep drain", () => {
  // GDD §3.2 — fleet upkeep is a per-tick credit drain on the active
  // Battlecruiser's current owner. These tests exercise the real economy
  // path (finite credits, no infiniteCredits flag) and pin both the drain
  // and the bankruptcy continuation contract.
  let upkeepGame: Game;
  let cruiserOwner: Player;
  let control: Player;

  beforeEach(async () => {
    // Two symmetric players — one flies the cruiser, the other is a
    // control subject with identical spawn conditions so per-tick income
    // cancels out of balance comparisons.
    upkeepGame = await setup(
      "half_land_half_ocean",
      {
        infiniteCredits: false,
        instantBuild: true,
      },
      [
        new PlayerInfo("pilot alpha", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("pilot beta", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (upkeepGame.inSpawnPhase()) {
      upkeepGame.executeNextTick();
    }

    cruiserOwner = upkeepGame.player("player_1_id");
    control = upkeepGame.player("player_2_id");
  });

  test("drains credits per tick while the cruiser is active", () => {
    const patrolTile = upkeepGame.ref(coastX + 1, 10);
    const cruiser = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    upkeepGame.addExecution(new BattlecruiserExecution(cruiser));

    // Equalize balances — both players then see identical per-tick credit
    // income from the sector map, so the balance gap that opens up across
    // ticks is attributable solely to fleet upkeep on the cruiser owner.
    cruiserOwner.removeCredits(cruiserOwner.credits());
    control.removeCredits(control.credits());
    cruiserOwner.addCredits(1_000_000n);
    control.addCredits(1_000_000n);

    // Run one warm-up tick so the BattlecruiserExecution has had its
    // init() firing pass and subsequent ticks all hit the steady-state
    // upkeep path. This keeps the balance-delta arithmetic unambiguous.
    upkeepGame.executeNextTick();

    const TICKS = 5;
    const ownerBefore = cruiserOwner.credits();
    const controlBefore = control.credits();

    for (let i = 0; i < TICKS; i++) {
      upkeepGame.executeNextTick();
    }

    const upkeep = upkeepGame.config().battlecruiserUpkeepPerTick(cruiserOwner);
    expect(upkeep).toBeGreaterThan(0n);

    // The only per-tick divergence between the two players is the fleet
    // upkeep on the cruiser owner's side: the control's balance delta
    // subtracts out all shared income/expense terms.
    const ownerDrop = ownerBefore - cruiserOwner.credits();
    const controlDrop = controlBefore - control.credits();
    expect(ownerDrop - controlDrop).toBe(upkeep * BigInt(TICKS));
  });

  test("cruiser stays active when the owner is bankrupt (upkeep is not a kill switch)", () => {
    const patrolTile = upkeepGame.ref(coastX + 1, 10);
    const cruiser = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    upkeepGame.addExecution(new BattlecruiserExecution(cruiser));

    // Drain credits every tick before the execution pass so the owner is
    // perpetually bankrupt. Income from creditAdditionRate would
    // otherwise add a baseline per tick.
    cruiserOwner.removeCredits(cruiserOwner.credits());
    for (let i = 0; i < 20; i++) {
      upkeepGame.executeNextTick();
      cruiserOwner.removeCredits(cruiserOwner.credits());
      expect(cruiserOwner.credits()).toBe(0n);
    }

    // removeCredits caps at 0, so the cruiser survives despite the owner
    // never being able to pay upkeep. This is the bankruptcy-is-not-a-
    // kill-switch contract from GDD §3.2.
    expect(cruiser.isActive()).toBe(true);
  });
});

describe("Battlecruiser — territory anchor", () => {
  // GDD §14 — the Battlecruiser is a mobile one-slot planet. Every
  // movement step, it converts deep-space tiles within
  // `battlecruiserTerritoryRadius()` into AsteroidField and claims any
  // unowned sector tiles. Enemy-owned and ally-owned tiles are left
  // alone, and an eliminated owner cannot be revived by the claim.
  let anchorGame: Game;
  let cruiserOwner: Player;
  let rival: Player;

  beforeEach(async () => {
    anchorGame = await setup(
      "half_land_half_ocean",
      {
        infiniteCredits: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("pilot alpha", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("pilot beta", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (anchorGame.inSpawnPhase()) {
      anchorGame.executeNextTick();
    }

    cruiserOwner = anchorGame.player("player_1_id");
    rival = anchorGame.player("player_2_id");

    // The test setup skips the SpawnExecution intent flow, so both
    // players exit the spawn phase with zero tiles and
    // `isAlive() === false`. That would short-circuit the
    // `claimTerritoryRadius` ownership branch before we ever exercise it.
    // Seed both players with a single sector tile each so `isAlive()` is
    // true — the tests below still enforce the ownership predicates.
    cruiserOwner.conquer(anchorGame.ref(0, 0));
    rival.conquer(anchorGame.ref(1, 0));
  });

  test("config exposes a positive territory radius by default", () => {
    expect(anchorGame.config().battlecruiserTerritoryRadius()).toBeGreaterThan(
      0,
    );
  });

  test("converts deep-space tiles along cruiser's path to AsteroidField sector tiles (NEXT movement)", () => {
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    // Sanity: the spawn tile starts as deep space on this map.
    expect(anchorGame.isDeepSpace(patrolTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));
    // Force real patrol movement through deep space by retargeting the
    // cruiser — this guarantees PathStatus.NEXT ticks drive claimTerritory.
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );

    executeTicks(anchorGame, 20);

    const radius = anchorGame.config().battlecruiserTerritoryRadius();
    const cruiserTile = bc.tile();
    const circle = anchorGame.circleSearch(cruiserTile, radius);
    let converted = 0;
    for (const tile of circle) {
      if (anchorGame.isSector(tile)) converted++;
    }
    // At minimum the tile the cruiser stands on must now be sector.
    expect(anchorGame.isSector(cruiserTile)).toBe(true);
    expect(converted).toBeGreaterThan(0);
  });

  test("claims unowned sector tiles along cruiser's path for the cruiser owner (NEXT movement)", () => {
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );

    const tilesBefore = cruiserOwner.numTilesOwned();

    executeTicks(anchorGame, 20);

    // Newly-promoted deep-space tiles along the path should count into
    // the cruiser owner's tile total.
    expect(cruiserOwner.numTilesOwned()).toBeGreaterThan(tilesBefore);
    const radius = anchorGame.config().battlecruiserTerritoryRadius();
    let cruiserOwnedInCircle = 0;
    for (const tile of anchorGame.circleSearch(bc.tile(), radius)) {
      if (anchorGame.owner(tile) === cruiserOwner) cruiserOwnedInCircle++;
    }
    expect(cruiserOwnedInCircle).toBeGreaterThan(0);
  });

  test("does NOT claim enemy-owned tiles within radius", () => {
    const patrolTile = anchorGame.ref(coastX + 1, 10);

    // Manually promote a nearby deep-space tile to a sector tile and
    // hand it to the rival player before the cruiser ever moves. The
    // claim pass must leave that tile in rival ownership.
    const enemyTile = anchorGame.ref(coastX + 2, 10);
    anchorGame.setTerrainType(enemyTile, TerrainType.AsteroidField);
    expect(anchorGame.isSector(enemyTile)).toBe(true);
    rival.conquer(enemyTile);
    expect(anchorGame.owner(enemyTile)).toBe(rival);
    const rivalTilesBefore = rival.numTilesOwned();

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));
    // Route the cruiser past the enemy tile so enemyTile is repeatedly
    // within claim radius during NEXT-branch movement ticks.
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );

    executeTicks(anchorGame, 20);

    // The enemy tile is still owned by the rival — the cruiser's
    // presence does not flip combat-required territory.
    expect(anchorGame.owner(enemyTile)).toBe(rival);
    expect(rival.numTilesOwned()).toBe(rivalTilesBefore);
  });

  test("converted territory stays sector after the cruiser moves away", () => {
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );

    // Drive the cruiser a few steps so an initial wake is laid down.
    executeTicks(anchorGame, 10);

    // Snapshot every tile that's a sector tile near the cruiser now —
    // these are what we expect to remain sector tiles permanently,
    // independent of where the cruiser patrols next.
    const radius = anchorGame.config().battlecruiserTerritoryRadius();
    const claimed: number[] = [];
    for (const tile of anchorGame.circleSearch(bc.tile(), radius)) {
      if (anchorGame.isSector(tile)) claimed.push(tile);
    }
    expect(claimed.length).toBeGreaterThan(0);

    // Let the cruiser keep patrolling. setTerrainType on a sector tile
    // is a no-op for DeepSpace/DebrisField, so the claimed wake must
    // persist indefinitely.
    executeTicks(anchorGame, 30);

    for (const tile of claimed) {
      expect(anchorGame.isSector(tile)).toBe(true);
    }
  });

  test("eliminated owner's cruiser still terraforms void but does NOT conquer", () => {
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );

    // Eliminate the cruiser's owner the canonical way: relinquish every
    // owned tile so `_tiles.size === 0`, which flips `isAlive()` off.
    for (const tile of Array.from(cruiserOwner.tiles())) {
      cruiserOwner.relinquish(tile);
    }
    expect(cruiserOwner.isAlive()).toBe(false);

    executeTicks(anchorGame, 20);

    // Terrain still promotes — the cruiser is a physical object and its
    // wake reshapes the map regardless of the pilot's political status.
    const cruiserTile = bc.tile();
    expect(anchorGame.isSector(cruiserTile)).toBe(true);

    // But no ownership was granted: conquering would add a tile to the
    // eliminated player and silently revive them, breaking permadeath.
    expect(cruiserOwner.numTilesOwned()).toBe(0);
    expect(cruiserOwner.isAlive()).toBe(false);
    expect(anchorGame.hasOwner(cruiserTile)).toBe(false);
  });

  test("keeps moving after claim bubble eliminates direct deep-space neighbors (coerceToWater BFS fallback)", () => {
    // Regression: claimTerritoryRadius() converts the cruiser tile AND
    // every tile within radius 5 into sector on each move. Once the
    // cruiser sits fully inside its own bubble, the old
    // SectorBoundaryCoercingTransformer.coerceToWater() returned null
    // because it only inspected direct neighbors. Fresh path
    // recomputations (e.g. after dirty-flag invalidation or a patrol
    // retarget) came back NOT_FOUND, and the cruiser stalled — breaking
    // the "mobile territory anchor" behavior after one move. The fix
    // BFS-searches outward for the nearest deep-space tile; the cruiser
    // must continue advancing across multiple patrol retargets.
    anchorGame.config().battlecruiserTargettingRange = () => 1;

    const startTile = anchorGame.ref(coastX + 1, 10);
    expect(anchorGame.isDeepSpace(startTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, startTile, {
      patrolTile: startTile,
    });
    // Slot a Colony so the gate at `claimTerritoryRadius()` (plans §5.3)
    // permits the wake — the regression here is path-stalling AFTER a
    // bubble forms, which only happens when the wake actually fires.
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));

    // Seed the cruiser with an initial patrol target so it moves off
    // its starting tile and lays down a claim bubble around its new
    // position.
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );
    executeTicks(anchorGame, 8);

    const postBubbleTile = bc.tile();
    expect(postBubbleTile).not.toBe(startTile);
    // The cruiser sits inside its own claim bubble: every direct
    // neighbor has been promoted to sector. This is the exact starting
    // condition the coerceToWater fix must handle.
    const directNeighbors = anchorGame.map().neighbors(postBubbleTile);
    const anyDirectDeepSpace = directNeighbors.some((n) =>
      anchorGame.isDeepSpace(n),
    );
    expect(anyDirectDeepSpace).toBe(false);

    // Force multiple post-claim path recomputations by retargeting the
    // cruiser's patrol tile. Each MoveBattlecruiserExecution resets
    // targetTile, so the next patrol() call picks a new random target
    // and invokes findPath() fresh from the cruiser's fully-enclosed
    // tile — hitting the BFS fallback branch in coerceToWater.
    // Map is 16×16 — half_land_half_ocean. Original retarget list used
    // coordinates beyond y=15 / x=15, which throw `Invalid coordinates`
    // before the test even runs. Clamped to valid bounds while preserving
    // the spread/direction of the original retargets.
    const visitedTiles = new Set<number>([postBubbleTile]);
    const retargets = [
      anchorGame.ref(coastX + 8, 15),
      anchorGame.ref(coastX + 3, 15),
      anchorGame.ref(coastX + 7, 14),
      anchorGame.ref(coastX + 2, 14),
    ];
    for (const target of retargets) {
      anchorGame.addExecution(
        new MoveBattlecruiserExecution(cruiserOwner, bc.id(), target),
      );
      executeTicks(anchorGame, 6);
      visitedTiles.add(bc.tile());
    }

    // The cruiser must advance to at least one additional tile beyond
    // postBubbleTile — otherwise it stalled inside its own bubble,
    // which is the regression.
    expect(visitedTiles.size).toBeGreaterThan(1);
    // And the cruiser must not still be sitting on the exact tile it
    // reached right after the first bubble formed.
    expect(bc.tile()).not.toBe(postBubbleTile);
  });

  test("does NOT claim territory on stationary COMPLETE (in-range freighter capture)", () => {
    // When the cruiser captures a freighter that's already within the
    // 5-tile dist threshold, PathFinderStepper returns COMPLETE with
    // node=from — the cruiser doesn't move. No terrain promotion or
    // tile conquering should happen on that stationary tick.
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    // Spaceport required so the cruiser will target freighters.
    cruiserOwner.buildUnit(UnitType.Spaceport, anchorGame.ref(coastX, 10), {});

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));

    // Freighter positioned within the 5-tile capture range of the
    // cruiser, heading to a rival spaceport (so it is a valid target).
    const freighter = rival.buildUnit(
      UnitType.TradeFreighter,
      anchorGame.ref(coastX + 1, 11),
      {
        targetUnit: rival.buildUnit(
          UnitType.Spaceport,
          anchorGame.ref(1, 0),
          {},
        ),
      },
    );

    const radius = anchorGame.config().battlecruiserTerritoryRadius();
    const startTile = bc.tile();
    // Snapshot terrain and ownership state in the cruiser's claim radius
    // BEFORE the capture tick.
    const priorTerrain = new Map<number, boolean>();
    const priorOwner = new Map<number, boolean>();
    for (const tile of anchorGame.circleSearch(startTile, radius)) {
      priorTerrain.set(tile, anchorGame.isDeepSpace(tile));
      priorOwner.set(tile, anchorGame.owner(tile) === cruiserOwner);
    }
    const ownedBefore = cruiserOwner.numTilesOwned();

    // Drive the cruiser enough ticks to capture. The execution inits on
    // tick N, ticks on N+1; a handful of ticks is plenty for an
    // in-range COMPLETE capture.
    for (let i = 0; i < 5; i++) {
      anchorGame.executeNextTick();
      if (freighter.owner() === cruiserOwner) break;
    }

    // Capture happened without the cruiser moving — this is the
    // stationary COMPLETE case the fix is protecting.
    expect(freighter.owner()).toBe(cruiserOwner);
    expect(bc.tile()).toBe(startTile);

    // Stationary COMPLETE must not claim — terrain and sector/owner
    // state in the claim radius is unchanged.
    for (const [tile, wasDeepSpace] of priorTerrain) {
      expect(anchorGame.isDeepSpace(tile)).toBe(wasDeepSpace);
    }
    for (const [tile, wasOwned] of priorOwner) {
      expect(anchorGame.owner(tile) === cruiserOwner).toBe(wasOwned);
    }
    expect(cruiserOwner.numTilesOwned()).toBe(ownedBefore);
  });

  // ── Colony-slot gate (plans §5.3 / issue #9) ─────────────────────────
  // The cruiser's territorial wake fires only when (a) the cruiser is
  // sitting on a deep-space tile AND (b) a Colony is slotted on it.
  // Both regressions below pin those gates so future refactors can't
  // accidentally re-enable wake behaviour for cruisers that are bare or
  // patrolling inside a sector.

  test("does NOT claim territory when no Colony is slotted (plans §5.3)", () => {
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    expect(anchorGame.isDeepSpace(patrolTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    // NOTE: no Colony slotted — the wake gate must reject the claim.
    anchorGame.addExecution(new BattlecruiserExecution(bc));
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 5, 15),
      ),
    );

    const tilesBefore = cruiserOwner.numTilesOwned();
    executeTicks(anchorGame, 20);

    // The cruiser moved through deep space, but no terraform / conquer
    // should have fired — the cruiser is a pure combat platform without
    // a Colony.
    expect(cruiserOwner.numTilesOwned()).toBe(tilesBefore);
    const radius = anchorGame.config().battlecruiserTerritoryRadius();
    for (const tile of anchorGame.circleSearch(bc.tile(), radius)) {
      // The cruiser's current tile may have been "carved out" by other
      // systems we don't control here, so we only require that none of
      // the radius tiles were CLAIMED by the cruiser owner.
      expect(anchorGame.owner(tile)).not.toBe(cruiserOwner);
    }
  });

  test("claimTerritoryRadius is a no-op while the cruiser stands on a sector tile (plans §5.3)", () => {
    // Stand the cruiser ON a sector tile and slot a Colony. The wake
    // gate's first precondition (`isDeepSpace(cruiser.tile())`) must
    // still suppress the claim even though the Colony precondition is
    // met. We don't issue a Move intent: that lets the deep-space
    // pathfinder fail (NOT_FOUND from a sector start) so the cruiser
    // never moves and we exercise only the gate, not the full patrol
    // loop. Without the gate, claimTerritoryRadius would conquer
    // tiles around the cruiser's sector position; with the gate it
    // returns early.
    const sectorTile = anchorGame.ref(2, 10);
    expect(anchorGame.isSector(sectorTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, sectorTile, {
      patrolTile: sectorTile,
    });
    slotColonyOn(bc, cruiserOwner);
    anchorGame.addExecution(new BattlecruiserExecution(bc));

    const tilesBefore = cruiserOwner.numTilesOwned();
    executeTicks(anchorGame, 3);

    // The cruiser is sitting on a sector tile — the deep-space gate must
    // suppress every wake call. Tile count is unchanged.
    expect(cruiserOwner.numTilesOwned()).toBe(tilesBefore);
  });
});
