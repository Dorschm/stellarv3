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

  test("user-directed move overrides auto-hunt of a trade freighter", async () => {
    // Regression: as the game ages, more trade freighters appear, and the
    // cruiser's `findTargetUnit` reliably finds one nearby every tick. The
    // hunt path bypasses `patrol()` (and therefore `targetTile`), so a
    // click-to-move issued via MoveBattlecruiserExecution gets silently
    // dropped on the next tick — the cruiser "stops listening" even though
    // the user told it where to go.
    //
    // The fix: when `patrolTile === targetTile` (the stable marker for a
    // user-issued directed move, since `randomTile()` always returns a
    // tile with a non-zero offset from `patrolTile`), the cruiser MUST
    // follow that target and ignore freighter auto-hunt.
    //
    // The regression guard below is intentionally NOT just
    // `patrolTile() === userDest`: the old broken behavior set
    // `patrolTile` from `MoveBattlecruiserExecution.init` *before*
    // `BattlecruiserExecution.tick` got a chance to pick a freighter and
    // chase it, so a patrol-tile-only assertion can be green even when
    // the cruiser is actually hunting freighters and never advancing
    // toward the click. We instead pin two motion-side invariants:
    //   1. The cruiser's `tile()` advances toward `userDest` (manhattan
    //      distance strictly decreases from the cruiser's starting tile).
    //   2. The cruiser does NOT capture (or transfer ownership of) any
    //      of the enemy freighters during the directed-move window —
    //      they remain owned by `player2`.
    player1.buildUnit(UnitType.Spaceport, game.ref(coastX, 10), {});
    const cruiserStart = game.ref(coastX + 1, 10);
    const battlecruiser = player1.buildUnit(
      UnitType.Battlecruiser,
      cruiserStart,
      {
        patrolTile: cruiserStart,
      },
    );
    game.addExecution(new BattlecruiserExecution(battlecruiser));

    // Stream of valid enemy TradeFreighters sitting on and near the
    // cruiser's tile so `findTargetUnit` will keep returning one every
    // tick across the entire directed-move window. The old broken
    // behavior would chase whichever was closest each tick, silently
    // overriding the directed move.
    const enemyPort = player2.buildUnit(
      UnitType.Spaceport,
      game.ref(coastX, 11),
      {},
    );
    const freighters = [
      player2.buildUnit(UnitType.TradeFreighter, cruiserStart, {
        targetUnit: enemyPort,
      }),
      player2.buildUnit(UnitType.TradeFreighter, game.ref(coastX + 1, 11), {
        targetUnit: enemyPort,
      }),
      player2.buildUnit(UnitType.TradeFreighter, game.ref(coastX + 2, 11), {
        targetUnit: enemyPort,
      }),
      player2.buildUnit(UnitType.TradeFreighter, game.ref(coastX + 1, 12), {
        targetUnit: enemyPort,
      }),
    ];

    // User clicks far away. The destination is intentionally far enough
    // that the cruiser cannot arrive within the assertion window — so
    // we can measure progress without the patrol target getting cleared
    // mid-test on `PathStatus.COMPLETE`.
    const userDest = game.ref(coastX + 5, 15);
    const startDist = game.manhattanDist(cruiserStart, userDest);
    game.addExecution(
      new MoveBattlecruiserExecution(player1, battlecruiser.id(), userDest),
    );

    // Multi-tick directed-move window. The old broken behavior chased
    // the under-the-cruiser freighter every tick and never advanced
    // toward `userDest`; with persistent freighter candidates around
    // the cruiser this directly exercises the pre-fix path.
    executeTicks(game, 10);

    // patrolTile is still the destination (cleared only on arrival).
    expect(battlecruiser.patrolTile()).toBe(userDest);

    // The cruiser actually moved toward the destination — not just set
    // `patrolTile` and froze. Manhattan-distance to userDest must have
    // strictly decreased from the cruiser's starting tile. This is the
    // assertion that catches the original "appears to ignore the move"
    // regression.
    const currentDist = game.manhattanDist(battlecruiser.tile(), userDest);
    expect(currentDist).toBeLessThan(startDist);

    // No freighter capture happened during the directed move. The old
    // auto-hunt path would `captureUnit` whichever freighter the
    // cruiser drifted into range of, transferring ownership to
    // `player1`; the fix must keep ownership on `player2` throughout.
    for (const f of freighters) {
      expect(f.owner().id()).toBe(player2.id());
    }
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
  // GDD §14 + Issue #9 — the Battlecruiser is a mobile one-slot planet. The
  // May 2026 balance pass gates the wake (deep-space terraform + unowned
  // tile conquer) on the cruiser carrying a Colony in its slot. These
  // tests slot a real Colony unit on the cruiser before each run so they
  // continue to exercise the claim path. Enemy-owned and ally-owned tiles
  // are left alone, and an eliminated owner cannot be revived by the claim.
  let anchorGame: Game;
  let cruiserOwner: Player;
  let rival: Player;

  function slotColonyOnCruiser(bc: Unit): void {
    // Park the Colony off-map (we don't care where for these tests); the
    // cruiser-side claim path only reads `slottedStructure().type()`.
    const colony = cruiserOwner.buildUnit(
      UnitType.Colony,
      anchorGame.ref(0, 0),
      {},
    );
    bc.setSlottedStructure(colony);
  }

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
    slotColonyOnCruiser(bc);
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
    slotColonyOnCruiser(bc);
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
    slotColonyOnCruiser(bc);
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
    slotColonyOnCruiser(bc);
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
    const visitedTiles = new Set<number>([postBubbleTile]);
    const retargets = [
      anchorGame.ref(coastX + 8, 18),
      anchorGame.ref(coastX + 3, 17),
      anchorGame.ref(coastX + 10, 20),
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

  test("Colony-gate: NO Colony slotted → no terraforming, no conquering even after movement (Bucket C)", () => {
    // Bucket C — the "Colony-gated territory expansion" rule. A
    // Battlecruiser without a Colony slot must NOT terraform deep-space
    // tiles into sector tiles, nor conquer unowned sector tiles, even
    // when it patrols across deep space. This pins the implementation
    // gate in `BattlecruiserExecution.claimTerritoryRadius`.
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    expect(anchorGame.isDeepSpace(patrolTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    // Intentionally NO `slotColonyOnCruiser(bc)`. Empty slot → no claim.
    expect(bc.slottedStructure()).toBeUndefined();
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

    // Cruiser actually moved (sanity).
    expect(bc.tile()).not.toBe(patrolTile);
    // Terrain promotion: the cruiser's current tile must still be deep
    // space — no terraforming happened because the Colony gate blocked it.
    expect(anchorGame.isDeepSpace(bc.tile())).toBe(true);
    // Tile ownership: the cruiser owner did NOT gain tiles from the wake.
    expect(cruiserOwner.numTilesOwned()).toBe(tilesBefore);
  });

  test("Colony-gate: cruiser INSIDE a sector with a Colony slotted → no terraforming, no conquering (Bucket C)", () => {
    // Bucket C — the deep-space precondition. Even with a Colony slotted,
    // a cruiser sitting on a sector tile must NOT claim. The implementation
    // returns early via `!isDeepSpace(this.battlecruiser.tile())`; if the
    // gate flipped open inside a sector, ground players could trivially
    // chain-claim adjacent tiles by parking a Colony-loaded cruiser there.
    //
    // We exercise the gate by invoking `claimTerritoryRadius` directly via
    // the (test-only) escape hatch on `BattlecruiserExecution`. Letting
    // the real BC execution tick would move the cruiser off the sector
    // tile via the DeepSpace pathfinder's coerce-to-void start path,
    // defeating the test premise. The direct call lands the production
    // gate logic on the exact (sector-tile, Colony-slotted) state we
    // want to verify.
    const sectorTile = anchorGame.ref(3, 3);
    expect(anchorGame.isSector(sectorTile)).toBe(true);
    const radius = anchorGame.config().battlecruiserTerritoryRadius();
    // Sanity: there is at least one unowned sector tile inside the
    // claim radius — otherwise the gate would have nothing to refuse.
    let unownedNearby = 0;
    for (const t of anchorGame.circleSearch(sectorTile, radius)) {
      if (anchorGame.isSector(t) && !anchorGame.hasOwner(t)) unownedNearby++;
    }
    expect(unownedNearby).toBeGreaterThan(0);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, sectorTile, {
      patrolTile: sectorTile,
    });
    slotColonyOnCruiser(bc);
    expect(bc.slottedStructure()?.type()).toBe(UnitType.Colony);
    expect(anchorGame.isDeepSpace(bc.tile())).toBe(false);

    // Construct + init the production execution but do NOT register it
    // with the game (so its tick() doesn't auto-move the cruiser). We
    // then call the gated claim method directly.
    const bcExec = new BattlecruiserExecution(bc);
    bcExec.init(anchorGame, 0);

    const tilesBefore = cruiserOwner.numTilesOwned();
    // Snapshot every unowned sector tile in radius before the claim
    // attempt so we can prove none of them flipped.
    const unownedSnapshot: number[] = [];
    for (const t of anchorGame.circleSearch(bc.tile(), radius)) {
      if (anchorGame.isSector(t) && !anchorGame.hasOwner(t)) {
        unownedSnapshot.push(t);
      }
    }
    expect(unownedSnapshot.length).toBeGreaterThan(0);

    // Direct invocation of the production gate. Inside-sector + Colony
    // slotted is the contract under test — the gate must return early
    // and leave terrain/ownership untouched.
    (
      bcExec as unknown as { claimTerritoryRadius(): void }
    ).claimTerritoryRadius();

    // No unowned tile inside radius was conquered — the in-sector gate
    // blocked the claim despite the slotted Colony.
    for (const t of unownedSnapshot) {
      expect(anchorGame.hasOwner(t)).toBe(false);
    }
    expect(cruiserOwner.numTilesOwned()).toBe(tilesBefore);
  });

  test("Colony-gate: cruiser in DEEP SPACE with Colony slotted → terraforms AND conquers (Bucket C)", () => {
    // Bucket C — the positive path that the two negative tests above
    // bracket. Identical setup to the existing "claims unowned sector
    // tiles along cruiser's path" test, but written as the explicit
    // third leg of the Colony-gate matrix so the three cases live next
    // to each other in the file.
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    expect(anchorGame.isDeepSpace(patrolTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOnCruiser(bc);
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

    // (a) The cruiser's current tile is now sector (terraformed).
    expect(anchorGame.isSector(bc.tile())).toBe(true);
    // (b) Numerous tiles were conquered — at minimum the cruiser owner
    // gained tiles relative to the start.
    expect(cruiserOwner.numTilesOwned()).toBeGreaterThan(tilesBefore);
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

  test("cruiser can pathfind through its own claimed wake (own-sector passable)", () => {
    // Regression: the cruiser's `claimTerritoryRadius` promotes
    // DeepSpace tiles to AsteroidField sector tiles owned by the cruiser
    // owner. The original `AStarDeepSpace` only accepted non-sector
    // tiles as passable neighbors, so a wake the cruiser already laid
    // down became an obstacle the cruiser could not re-traverse — it
    // had to detour around its own territory. `PathFinding.CapitalShip`
    // marks sector tiles owned by the cruiser's current owner as
    // passable, restoring the "mobile one-slot planet" intent: the
    // cruiser flies through its empire's space, not around it.
    const patrolTile = anchorGame.ref(coastX + 1, 10);
    expect(anchorGame.isDeepSpace(patrolTile)).toBe(true);

    const bc = cruiserOwner.buildUnit(UnitType.Battlecruiser, patrolTile, {
      patrolTile,
    });
    slotColonyOnCruiser(bc);
    anchorGame.addExecution(new BattlecruiserExecution(bc));

    // Drive the cruiser forward so it lays a wake of owned sector
    // tiles. After this leg, the cruiser sits *inside* its own wake
    // bubble — the exact pre-fix dead-end where the deep-space-only
    // pathfinder produced NOT_FOUND or forced a long detour.
    // (`half_land_half_ocean` is 16×16, so all coords must be ≤ 15.)
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(
        cruiserOwner,
        bc.id(),
        anchorGame.ref(coastX + 4, 13),
      ),
    );
    executeTicks(anchorGame, 12);

    const cruiserTile = bc.tile();
    // Sanity: confirm the cruiser is in a sector tile it owns (its own
    // wake) so we're exercising the owner-aware passability path. If
    // the cruiser ended on deep space this test isn't testing what it
    // claims to test.
    expect(anchorGame.isSector(cruiserTile)).toBe(true);
    expect(anchorGame.owner(cruiserTile)).toBe(cruiserOwner);

    // Drive the cruiser forward once more, this time across its own
    // wake toward fresh deep space on the far side. The destination is
    // intentionally further into deep space so the route must cross
    // owned sector tiles to make progress. The pre-fix pathfinder
    // could only navigate via deep-space neighbors and would either
    // refuse the path (`NOT_FOUND`) or stall.
    const farTarget = anchorGame.ref(coastX + 7, 15);
    anchorGame.addExecution(
      new MoveBattlecruiserExecution(cruiserOwner, bc.id(), farTarget),
    );

    const tilesBeforeSecondLeg = cruiserOwner.numTilesOwned();
    const startDist = anchorGame.manhattanDist(bc.tile(), farTarget);
    executeTicks(anchorGame, 15);

    // Strict progress: cruiser's Manhattan-distance to the destination
    // must strictly decrease. With the wake blocking, the pre-fix
    // pathfinder produced no progress.
    const endDist = anchorGame.manhattanDist(bc.tile(), farTarget);
    expect(endDist).toBeLessThan(startDist);

    // The cruiser must have continued laying down wake — it cannot do
    // that unless its pathfinder advances it through deep space and
    // own-owned wake tiles together. `numTilesOwned` strictly
    // increasing confirms wake extension along the second leg.
    expect(cruiserOwner.numTilesOwned()).toBeGreaterThan(tilesBeforeSecondLeg);
  });
});
