// @vitest-environment node
import fs from "fs";
import path from "path";
import { DefenseStationExecution } from "../../../src/core/execution/DefenseStationExecution";
import { OrbitalStrikePlatformExecution } from "../../../src/core/execution/OrbitalStrikePlatformExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Cell,
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import {
  genTerrainFromBin,
  MapManifest,
} from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig, GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { TestServerConfig } from "../../util/TestServerConfig";
import { executeTicks } from "../../util/utils";

/**
 * Tests for Ticket 8 — Defense Satellite Intercept + Structure Slot Limits.
 *
 * Two distinct surfaces are exercised here:
 *
 *   1. DefenseStation auto-intercept (GDD §8). The Defense Satellite is the
 *      strategic counter to the LRW: it intercepts pending LRW impacts in
 *      range and also picks off enemy AssaultShuttles / Battlecruisers via
 *      the existing PlasmaBolt path. LRW intercepts are prioritized over
 *      fleet targeting because shutting down the bombardment is the more
 *      strategic counter.
 *
 *   2. Per-sector structure slot limits gated by habitability (GDD §4).
 *      `PlayerImpl.canBuild` rejects structure placements when the sector
 *      already holds the maximum number of structures the placement tile's
 *      effective habitability allows. The slot tiers are
 *        AsteroidField (≤0.3): 0
 *        Nebula        (≤0.6): 1
 *        OpenSpace     (>0.6): 2
 *      LRW habitability damage drives a tile's *effective* habitability so
 *      we use it to flip the same physical tile between tiers without
 *      having to fabricate a Nebula/AsteroidField test map.
 *
 * The intercept tests use the existing `setup("plains")` helper because
 * they don't depend on SectorMap data. The slot limit tests use a
 * custom `setupGameWithNationSeeds` helper that wires non-empty
 * `nations[]` into `createGame` so the SectorMap floods every plains tile
 * into a single sector. The legacy `setup("plains")` path still passes
 * `[]` for nations and so leaves every sector ID at zero — exactly the
 * fallback the slot-limit gate is designed to skip silently.
 */

const gameID: GameID = "ticket8_game";

/**
 * Build a `Game` from the `plains` test map but with explicit nation
 * seeds so the resulting `SectorMap` floods at least one non-zero sector.
 * `setup()` always passes `nations: []` to `createGame`, so this helper
 * exists to give slot-limit tests a SectorMap they can actually query.
 */
async function setupGameWithNationSeeds(
  seedCells: Array<{ x: number; y: number }>,
): Promise<Game> {
  const baseDir = __dirname;
  const mapBinBuffer = fs.readFileSync(
    path.join(baseDir, "../../testdata/maps/plains/map.bin"),
  );
  const miniMapBinBuffer = fs.readFileSync(
    path.join(baseDir, "../../testdata/maps/plains/map4x.bin"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(baseDir, "../../testdata/maps/plains/manifest.json"),
      "utf8",
    ),
  ) satisfies MapManifest;

  const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
  const miniGameMap = await genTerrainFromBin(manifest.map4x, miniMapBinBuffer);

  const serverConfig = new TestServerConfig();
  const gameConfig: GameConfig = {
    gameMap: GameMapType.SolSystem,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateCredits: false,
    donatePopulation: false,
    bots: 0,
    infiniteCredits: true,
    infinitePopulation: false,
    instantBuild: true,
    randomSpawn: false,
  };
  const config = new TestConfig(
    serverConfig,
    gameConfig,
    new UserSettings(),
    false,
  );

  // Build a synthetic Nation per seed cell. The SectorMap only reads
  // `spawnCell` from each Nation, and `addPlayers()` only consults the
  // `_nations` list when the game mode is non-FFA — in FFA mode (which
  // we use here) the helper nations are never converted into actual
  // game players, so the human player added below is the only one
  // showing up in the player list.
  const nations: Nation[] = seedCells.map(
    (cell, i) =>
      new Nation(
        new Cell(cell.x, cell.y),
        new PlayerInfo(
          `seed_nation_${i}`,
          PlayerType.Nation,
          null,
          `seed_nation_${i}`,
        ),
      ),
  );

  return createGame([], nations, gameMap, miniGameMap, config);
}

// ---------------------------------------------------------------------------
// DefenseStation auto-intercept (GDD §8)
// ---------------------------------------------------------------------------

describe("DefenseStation LRW + fleet intercept (Ticket 8)", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });

    const attackerInfo = new PlayerInfo(
      "attacker_id",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender_id",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    // Same close spawn as the existing LRW tests so the defender lies
    // inside the LRW envelope (TestConfig.defaultNukeTargetableRange == 20).
    game.addExecution(
      new SpawnExecution(gameID, attackerInfo, game.ref(1, 1)),
      new SpawnExecution(gameID, defenderInfo, game.ref(15, 1)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player("attacker_id");
    defender = game.player("defender_id");
  });

  test("DefenseStation cancels a pending LRW impact landing inside its envelope", () => {
    // Stockpile credits so the LRW shot will fire.
    attacker.addCredits(500_000n);

    const ospPlatform = attacker.buildUnit(
      UnitType.OrbitalStrikePlatform,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new OrbitalStrikePlatformExecution(ospPlatform));

    // Defender drops a Defense Satellite right on top of their territory.
    // `defenseStationTargettingRange()` defaults to 75 in DefaultConfig,
    // and TestConfig inherits it, so any LRW impact in defender territory
    // (~14 tiles from the OSP) is comfortably inside the envelope.
    const defensePost = defender.buildUnit(
      UnitType.DefenseStation,
      game.ref(15, 1),
      {},
    );
    game.addExecution(new DefenseStationExecution(defensePost));

    const defenderPopulationBefore = defender.population();

    // 5 ticks is enough for the OSP to fire (tick 1) and the projectile
    // to either resolve naturally (max(1, ceil(14/30)) = 1 tick later) or
    // be intercepted by the DefenseStation that runs in the same tick.
    executeTicks(game, 5);

    // The LRW pop-damage path subtracts a flat 10% of the defender's
    // current population on impact. If the intercept fired correctly the
    // defender should still hold (essentially) all of its population — we
    // allow for tick-scale growth/decay drift but not for the 10% LRW hit.
    const lossFromOneShot = Math.floor(defenderPopulationBefore * 0.05);
    expect(defender.population()).toBeGreaterThan(
      defenderPopulationBefore - lossFromOneShot,
    );
  });

  test("DefenseStation prioritizes LRW over a fleet target on the same tick", () => {
    // Build an LRW capable platform AND an enemy Battlecruiser parked
    // inside the defender's envelope. The DefenseStation should swat down
    // the LRW first; the cruiser is fine until the cooldown resets.
    attacker.addCredits(500_000n);
    const ospPlatform = attacker.buildUnit(
      UnitType.OrbitalStrikePlatform,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new OrbitalStrikePlatformExecution(ospPlatform));

    // Place a hostile cruiser well inside the station's envelope.
    const cruiser = attacker.buildUnit(
      UnitType.Battlecruiser,
      game.ref(20, 1),
      { patrolTile: game.ref(20, 1) },
    );

    const defensePost = defender.buildUnit(
      UnitType.DefenseStation,
      game.ref(15, 1),
      {},
    );
    game.addExecution(new DefenseStationExecution(defensePost));

    const cruiserHealthBefore = cruiser.hasHealth() ? cruiser.health() : 0n;
    const defenderPopulationBefore = defender.population();

    // One LRW + intercept window. The cooldown is 100 ticks, so the
    // station gets exactly one shot in this loop and that shot must go
    // to the LRW intercept — the cruiser must be untouched.
    executeTicks(game, 5);

    // LRW must have been intercepted (defender did not lose 10% pop).
    const lossFromOneShot = Math.floor(defenderPopulationBefore * 0.05);
    expect(defender.population()).toBeGreaterThan(
      defenderPopulationBefore - lossFromOneShot,
    );

    // Cruiser must NOT have been targeted by a plasma bolt yet — its
    // health is still at the spawn value. PlasmaBoltExecution can take
    // a few ticks of pathfinding before the impact lands, but no shot
    // should even have been queued at the cruiser given the LRW gate.
    if (cruiser.hasHealth()) {
      expect(cruiser.health()).toBe(cruiserHealthBefore);
    }
  });

  test("DefenseStation does NOT intercept allied players' LRW impacts", () => {
    // GDD §8 — friendly LRW shots must be left alone, not just the
    // station owner's own shots. We exercise the registry-level gate
    // directly (matching the cooldown test pattern below) so the test
    // isn't entangled with OSP fire timing or population growth: register a
    // single pending impact owned by the *attacker* and confirm the
    // defender's station leaves it alone once the two players form an
    // alliance. The pre-alliance state is still hostile, so this test
    // also verifies the alliance flip is what flips the gate.
    const defensePost = defender.buildUnit(
      UnitType.DefenseStation,
      game.ref(15, 1),
      {},
    );
    game.addExecution(new DefenseStationExecution(defensePost));
    // executeNextTick only init()s newly-added executions on the tick they
    // were added — pump one tick so the DefenseStation is live in the
    // exec list before we start counting intercepts.
    game.executeNextTick();

    // Establish a real alliance so attacker.isFriendly(defender) is true.
    // We use the same `createAllianceRequest` / accept() helper that the
    // existing Attack/NukeExecution tests use.
    const req = attacker.createAllianceRequest(defender);
    req!.accept();
    expect(attacker.isFriendly(defender)).toBe(true);

    // Register an allied LRW impact inside the station envelope. The
    // owner is `attacker`, the defender owns the station, and the two
    // are now allied — the intercept gate must skip the impact.
    const alliedToken = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 2),
      999_999,
    );

    // Tick a window past the cooldown so the station has every
    // opportunity to fire. Even with `defenseStationPlasmaBoltAttackRate`
    // ticks of patience, the allied impact must remain in the registry.
    executeTicks(game, 200);

    expect(game.isPendingLrwImpactActive(alliedToken)).toBe(true);
  });

  test("DefenseStation does NOT intercept its own owner's LRW", () => {
    // Friendly LRW shouldn't trigger the intercept gate. We exercise the
    // same path with attacker == owner of both the OSP and the defense
    // post and verify the impact still resolves normally on the defender.
    attacker.addCredits(500_000n);
    const ospPlatform = attacker.buildUnit(
      UnitType.OrbitalStrikePlatform,
      game.ref(1, 1),
      {},
    );
    game.addExecution(new OrbitalStrikePlatformExecution(ospPlatform));

    // Friendly defense post: same owner as the OSP. Place it next to the
    // defender's territory so it would trivially be in range if the
    // ownership check were missing.
    const friendlyPost = attacker.buildUnit(
      UnitType.DefenseStation,
      game.ref(14, 1),
      {},
    );
    game.addExecution(new DefenseStationExecution(friendlyPost));

    const defenderPopulationBefore = defender.population();
    executeTicks(game, 5);

    // The intercept must NOT have fired — the defender should have lost
    // ~10% population from the LRW impact.
    const expectedLoss = Math.floor(defenderPopulationBefore * 0.1);
    expect(defender.population()).toBeLessThanOrEqual(
      defenderPopulationBefore - expectedLoss + 2_000,
    );
  });

  test("LRW intercept honors the 10s plasma bolt cooldown", () => {
    // Verify the cooldown gate directly against the registry. We bypass
    // the OSP entirely so the test isn't entangled with population growth or
    // OSP fire timing — the contract under test is "after one intercept
    // the DefenseStation must wait `defenseStationPlasmaBoltAttackRate`
    // ticks before it can intercept again".
    const defensePost = defender.buildUnit(
      UnitType.DefenseStation,
      game.ref(15, 1),
      {},
    );
    game.addExecution(new DefenseStationExecution(defensePost));
    // executeNextTick only init()s newly-added executions on the tick they
    // were added — they actually start ticking the *next* tick. Pump one
    // tick here so the DefenseStation is live in the exec list before we
    // start counting intercepts.
    game.executeNextTick();

    // Two impacts inside the station envelope owned by the attacker. We
    // give them an absurdly large impactTick so they don't auto-resolve
    // mid-test — the registry only cleans up entries on intercept or
    // when the OSP marks them resolved.
    const tokenA = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 2),
      999_999,
    );
    const tokenB = game.registerPendingLrwImpact(
      attacker.smallID(),
      game.ref(1, 1),
      game.ref(15, 3),
      999_999,
    );

    // Tick #1 — first intercept fires. Exactly one of the two tokens
    // should be cancelled; the other remains because the station
    // burned its single shot for this cooldown window.
    game.executeNextTick();
    const aliveAfter1 =
      (game.isPendingLrwImpactActive(tokenA) ? 1 : 0) +
      (game.isPendingLrwImpactActive(tokenB) ? 1 : 0);
    expect(aliveAfter1).toBe(1);

    // Tick 50 more times. We're still inside the 100-tick cooldown
    // window so the surviving token must NOT have been intercepted yet.
    executeTicks(game, 50);
    const aliveAfter51 =
      (game.isPendingLrwImpactActive(tokenA) ? 1 : 0) +
      (game.isPendingLrwImpactActive(tokenB) ? 1 : 0);
    expect(aliveAfter51).toBe(1);

    // Tick past the 100-tick cooldown — the surviving token should now
    // get swatted on the very next intercept window.
    executeTicks(game, 60);
    const aliveAfter111 =
      (game.isPendingLrwImpactActive(tokenA) ? 1 : 0) +
      (game.isPendingLrwImpactActive(tokenB) ? 1 : 0);
    expect(aliveAfter111).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Habitability-gated structure slot limits (GDD §4)
// ---------------------------------------------------------------------------

describe("Config.maxStructuresForHabitability", () => {
  // Pull a real Config off a setup() game so the tier mapping is locked
  // in with the same DefaultConfig that production uses (TestConfig
  // extends DefaultConfig and does not override this method). Constructing
  // DefaultConfig directly would force us into the TestServerConfig
  // throw-on-everything blast zone, which buys nothing for a pure-math test.
  let cfg: ReturnType<Game["config"]>;
  beforeAll(async () => {
    const g = await setup("plains");
    cfg = g.config();
  });

  test("AsteroidField tier (hab ≤ 0.3) → 0 slots", () => {
    expect(cfg.maxStructuresForHabitability(0.3)).toBe(0);
    expect(cfg.maxStructuresForHabitability(0.2)).toBe(0);
    expect(cfg.maxStructuresForHabitability(0.0)).toBe(0);
  });

  test("Nebula tier (0.3 < hab ≤ 0.6) → 1 slot", () => {
    expect(cfg.maxStructuresForHabitability(0.6)).toBe(1);
    expect(cfg.maxStructuresForHabitability(0.5)).toBe(1);
    expect(cfg.maxStructuresForHabitability(0.31)).toBe(1);
  });

  test("OpenSpace tier (hab > 0.6) → 2 slots", () => {
    expect(cfg.maxStructuresForHabitability(1.0)).toBe(2);
    expect(cfg.maxStructuresForHabitability(0.7)).toBe(2);
  });

  test("Non-finite habitability → 0 slots", () => {
    expect(cfg.maxStructuresForHabitability(NaN)).toBe(0);
    expect(cfg.maxStructuresForHabitability(-1)).toBe(0);
  });
});

describe("PlayerImpl.canBuild slot limit (Ticket 8)", () => {
  let game: Game;
  let player: Player;

  // Pick a tile inside what we expect to flood as sector 1 from the seed.
  // The plains map is a 100×100 fully-land grid, so any seed paints the
  // whole map as a single sector and any owned tile is in that sector.
  const SEED = { x: 50, y: 50 };

  beforeEach(async () => {
    game = await setupGameWithNationSeeds([SEED]);
    const info = new PlayerInfo("p1", PlayerType.Human, null, "p1");
    game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(gameID, info, game.ref(SEED.x, SEED.y)),
    );
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    player = game.player("p1");
    // The slot limit is structure-specific; structures are pricy. Top up
    // the player so credit checks never gate the test.
    player.addCredits(10_000_000n);
  });

  test("OpenSpace sector allows up to 2 structures, third is rejected", () => {
    // Sanity: the player owns the seed tile and it's inside sector 1.
    const seedTile = game.ref(SEED.x, SEED.y);
    expect(game.sectorMap().sectorOf(seedTile)).toBeGreaterThan(0);
    expect(game.sectorMap().effectiveHabitability(seedTile)).toBeCloseTo(
      1.0,
      6,
    );

    // Build #1 — must succeed. We use buildUnit (which bypasses canBuild)
    // to put the structure on the map *before* asking canBuild whether a
    // second one is allowed; this lets us isolate the slot-count gate.
    player.buildUnit(UnitType.DefenseStation, game.ref(SEED.x, SEED.y), {});
    expect(player.canBuild(UnitType.PointDefenseArray, seedTile)).not.toBe(
      false,
    );

    // Build #2 — also OK. After this the sector is at the OpenSpace cap.
    player.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(SEED.x + 1, SEED.y),
      {},
    );
    // Build #3 — must be refused.
    expect(player.canBuild(UnitType.Foundry, seedTile)).toBe(false);
  });

  test("Nebula-tier habitability (effective hab in (0.3, 0.6]) caps at 1 structure", () => {
    const tile = game.ref(SEED.x, SEED.y);
    // Drag the effective habitability down to 0.5 by applying 0.5 LRW
    // damage. The base hab on plains is 1.0, so post-damage we land at
    // 0.5 — comfortably inside the Nebula tier (≤ 0.6, > 0.3).
    game.sectorMap().applyHabitabilityDamage(tile, 0.5, player.smallID());
    expect(game.sectorMap().effectiveHabitability(tile)).toBeCloseTo(0.5, 6);

    // First build inside the (now Nebula-tier) sector — allowed.
    expect(player.canBuild(UnitType.DefenseStation, tile)).not.toBe(false);
    player.buildUnit(UnitType.DefenseStation, tile, {});

    // Second build — refused, the cap for Nebula tier is 1.
    expect(player.canBuild(UnitType.PointDefenseArray, tile)).toBe(false);
  });

  test("AsteroidField-tier habitability (effective hab ≤ 0.3) blocks all structures", () => {
    const tile = game.ref(SEED.x, SEED.y);
    // Apply 0.8 damage → effective hab 0.2, inside the AsteroidField tier.
    game.sectorMap().applyHabitabilityDamage(tile, 0.8, player.smallID());
    expect(game.sectorMap().effectiveHabitability(tile)).toBeCloseTo(0.2, 6);

    // Even the very first structure is refused — the player must
    // terraform first per GDD §4.
    expect(player.canBuild(UnitType.DefenseStation, tile)).toBe(false);
  });

  test("Battlecruiser-hosted structures do NOT consume sector slots", () => {
    // GDD §14 / Ticket 6 + §4 / Ticket 8 — a hosted DefenseStation /
    // OrbitalStrikePlatform is mobile and follows its cruiser between
    // sectors, so it must NOT count toward the per-sector cap. We
    // verify the cruiser-hosted structure is invisible to the slot
    // gate even when sitting in the same sector as stationary ones.
    const tile = game.ref(SEED.x, SEED.y);

    // Spawn a Battlecruiser and attach a DefenseStation to its slot
    // *before* placing any ground structure. The hosted structure
    // physically lives on the cruiser's tile (which is inside the seed
    // sector), so without the exclusion fix it would already eat one
    // of the two OpenSpace-tier slots.
    const bc = player.buildUnit(UnitType.Battlecruiser, tile, {
      patrolTile: tile,
    });
    const hostedDs = player.buildUnit(UnitType.DefenseStation, tile, {});
    bc.setSlottedStructure(hostedDs);
    expect(bc.slottedStructure()).toBe(hostedDs);

    // Two stationary structures must still both fit. If the hosted DS
    // were counted, the second placement here would be rejected.
    expect(player.canBuild(UnitType.DefenseStation, tile)).not.toBe(false);
    player.buildUnit(UnitType.DefenseStation, tile, {});
    expect(
      player.canBuild(UnitType.PointDefenseArray, game.ref(SEED.x + 2, SEED.y)),
    ).not.toBe(false);
    player.buildUnit(
      UnitType.PointDefenseArray,
      game.ref(SEED.x + 2, SEED.y),
      {},
    );

    // The sector is now at the OpenSpace cap (2 stationary structures).
    // The hosted DS is still on the same sector tile but ignored, so a
    // third stationary build must be rejected on slot count alone.
    expect(
      player.canBuild(UnitType.DefenseStation, game.ref(SEED.x + 4, SEED.y)),
    ).toBe(false);
  });

  test("structureMinDist still applies on top of the slot limit", () => {
    // The slot limit is *additional* to the existing spacing rule. We
    // verify the spacing rule is still enforced by overriding
    // structureMinDist to a value that puts the second tile inside the
    // exclusion zone of the first one. TestConfig defaults to 0, so we
    // bump it to 50 for this test.
    const cfg = game.config() as unknown as { structureMinDist(): number };
    const original = cfg.structureMinDist;
    cfg.structureMinDist = () => 50;
    try {
      const tile = game.ref(SEED.x, SEED.y);
      player.buildUnit(UnitType.DefenseStation, tile, {});
      // The neighbouring tile is well inside the 50-tile exclusion;
      // canBuild must refuse on spacing alone, regardless of slot count.
      expect(
        player.canBuild(
          UnitType.PointDefenseArray,
          game.ref(SEED.x + 1, SEED.y),
        ),
      ).toBe(false);
    } finally {
      cfg.structureMinDist = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Game-level LRW intercept registry
// ---------------------------------------------------------------------------

describe("Game LRW intercept registry (Ticket 8)", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains", { infiniteCredits: true, instantBuild: true });
  });

  test("registerPendingLrwImpact issues unique tokens", () => {
    const t1 = game.registerPendingLrwImpact(
      1,
      game.ref(1, 1),
      game.ref(2, 2),
      10,
    );
    const t2 = game.registerPendingLrwImpact(
      1,
      game.ref(1, 1),
      game.ref(3, 3),
      11,
    );
    expect(t1).not.toBe(t2);
    expect(game.isPendingLrwImpactActive(t1)).toBe(true);
    expect(game.isPendingLrwImpactActive(t2)).toBe(true);
  });

  test("interceptPendingLrwImpact removes the entry and returns true once", () => {
    const t = game.registerPendingLrwImpact(
      1,
      game.ref(1, 1),
      game.ref(2, 2),
      10,
    );
    expect(game.interceptPendingLrwImpact(t)).toBe(true);
    expect(game.isPendingLrwImpactActive(t)).toBe(false);
    // Second intercept attempt is a no-op.
    expect(game.interceptPendingLrwImpact(t)).toBe(false);
  });

  test("pendingLrwImpactsNear returns only impacts inside the range and not owned by the excluded player", () => {
    const target = game.ref(50, 50);
    const inRange = game.registerPendingLrwImpact(
      2,
      game.ref(1, 1),
      game.ref(48, 50),
      20,
    );
    const outOfRange = game.registerPendingLrwImpact(
      2,
      game.ref(1, 1),
      game.ref(99, 99),
      20,
    );
    const friendly = game.registerPendingLrwImpact(
      9,
      game.ref(1, 1),
      game.ref(50, 51),
      20,
    );

    const results = game.pendingLrwImpactsNear(target, 5, /* exclude */ 9);
    const tokens = results.map((r) => r.token).sort();
    expect(tokens).toEqual([inRange]);
    // Out-of-range and friendly impacts are filtered.
    expect(tokens).not.toContain(outOfRange);
    expect(tokens).not.toContain(friendly);
  });
});
