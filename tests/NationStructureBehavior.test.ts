import { vi } from "vitest";
import { NationStructureBehavior } from "../src/core/execution/nation/NationStructureBehavior";
import {
  Difficulty,
  PlayerType,
  Relation,
  UnitType,
} from "../src/core/game/Game";
import { Cluster } from "../src/core/game/TradeHub";
import { PseudoRandom } from "../src/core/PseudoRandom";

// ── Fixed trade-credits values matching DefaultConfig ──────────────────────────

const TRAIN_CREDITS: Record<string, bigint> = {
  self: 10_000n,
  team: 25_000n,
  ally: 35_000n,
  other: 25_000n,
};

const MAX_TRADE_CREDITS = Number(TRAIN_CREDITS.ally); // denominator

// ── Factory helpers ──────────────────────────────────────────────────────────

function makeUnit(tile: number): any {
  return { tile: () => tile };
}

function makeStation(unit: any, cluster: Cluster | null = null): any {
  return { unit, getCluster: () => cluster };
}

function makeGame(stations: any[] = []): any {
  return {
    config: () => ({
      frigateCredits: (rel: string, _citiesVisited: number) =>
        TRAIN_CREDITS[rel] ?? 0n,
    }),
    // `Game.hyperspaceLaneNetwork()` is the post-rename accessor (was
    // `railNetwork()`); `NationStructureBehavior.buildReachableStations`
    // reads stations via `game.hyperspaceLaneNetwork().stationManager()`.
    hyperspaceLaneNetwork: () => ({
      stationManager: () => ({ getAll: () => new Set(stations) }),
    }),
  };
}

function makePlayer(
  ownUnits: any[],
  neighborList: any[],
  opts: {
    canTrade?: (n: any) => boolean;
    isOnSameTeam?: (n: any) => boolean;
    isAlliedWith?: (n: any) => boolean;
  } = {},
): any {
  return {
    units: vi.fn(() => ownUnits),
    neighbors: vi.fn(() => neighborList),
    canTrade: vi.fn((n: any) => opts.canTrade?.(n) ?? true),
    isOnSameTeam: vi.fn((n: any) => opts.isOnSameTeam?.(n) ?? false),
    isAlliedWith: vi.fn((n: any) => opts.isAlliedWith?.(n) ?? false),
  };
}

function makeNeighbor(
  opts: {
    isPlayer?: boolean;
    type?: PlayerType;
    units?: any[];
  } = {},
): any {
  return {
    isPlayer: () => opts.isPlayer ?? true,
    type: () => opts.type ?? PlayerType.Human,
    units: vi.fn(() => opts.units ?? []),
  };
}

function makeBehavior(
  game: any,
  player: any,
  random: PseudoRandom = new PseudoRandom(0),
): NationStructureBehavior {
  return new NationStructureBehavior(random, game, player);
}

// ── shouldUseConnectivityScore ───────────────────────────────────────────────

describe("NationStructureBehavior.shouldUseConnectivityScore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function behaviorWithNextInt(returnValue: number): {
    behavior: NationStructureBehavior;
    random: PseudoRandom;
  } {
    const random = new PseudoRandom(0);
    vi.spyOn(random, "nextInt").mockReturnValue(returnValue);
    const behavior = makeBehavior(makeGame(), makePlayer([], []), random);
    return { behavior, random };
  }

  it("always returns false for Easy (randomChance = 0)", () => {
    for (const v of [0, 50, 99]) {
      const { behavior, random } = behaviorWithNextInt(v);
      vi.spyOn(random, "nextInt").mockReturnValue(v);
      expect(
        (behavior as any).shouldUseConnectivityScore(Difficulty.Easy),
      ).toBe(false);
    }
  });

  it("returns true for Medium when nextInt < 60", () => {
    const { behavior } = behaviorWithNextInt(59);
    expect(
      (behavior as any).shouldUseConnectivityScore(Difficulty.Medium),
    ).toBe(true);
  });

  it("returns false for Medium when nextInt === 60 (boundary)", () => {
    const { behavior } = behaviorWithNextInt(60);
    expect(
      (behavior as any).shouldUseConnectivityScore(Difficulty.Medium),
    ).toBe(false);
  });

  it("returns true for Hard when nextInt < 75", () => {
    const { behavior } = behaviorWithNextInt(74);
    expect((behavior as any).shouldUseConnectivityScore(Difficulty.Hard)).toBe(
      true,
    );
  });

  it("returns false for Hard when nextInt === 75 (boundary)", () => {
    const { behavior } = behaviorWithNextInt(75);
    expect((behavior as any).shouldUseConnectivityScore(Difficulty.Hard)).toBe(
      false,
    );
  });

  it("always returns true for Impossible (randomChance = 100)", () => {
    for (const v of [0, 50, 99]) {
      const { behavior, random } = behaviorWithNextInt(v);
      vi.spyOn(random, "nextInt").mockReturnValue(v);
      expect(
        (behavior as any).shouldUseConnectivityScore(Difficulty.Impossible),
      ).toBe(true);
    }
  });
});

// ── buildReachableStations ───────────────────────────────────────────────────

describe("NationStructureBehavior.buildReachableStations", () => {
  const selfWeight = Number(TRAIN_CREDITS.self) / MAX_TRADE_CREDITS;
  const allyWeight = Number(TRAIN_CREDITS.ally) / MAX_TRADE_CREDITS;
  const teamWeight = Number(TRAIN_CREDITS.team) / MAX_TRADE_CREDITS;
  const otherWeight = Number(TRAIN_CREDITS.other) / MAX_TRADE_CREDITS;

  it("includes own registered units with self weight and correct cluster", () => {
    const cluster = new Cluster();
    const unit = makeUnit(10);
    const station = makeStation(unit, cluster);
    const player = makePlayer([unit], []);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].tile).toBe(10);
    expect(result[0].cluster).toBe(cluster);
    expect(result[0].weight).toBeCloseTo(selfWeight);
  });

  it("assigns null cluster when own unit is a station with no cluster", () => {
    const unit = makeUnit(11);
    const station = makeStation(unit, null);
    const player = makePlayer([unit], []);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].cluster).toBeNull();
    expect(result[0].weight).toBeCloseTo(selfWeight);
  });

  it("excludes own units not registered in the station manager", () => {
    const unit = makeUnit(20);
    // No stations in station manager
    const player = makePlayer([unit], []);
    const behavior = makeBehavior(makeGame([]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("excludes bot neighbors", () => {
    const unit = makeUnit(30);
    const station = makeStation(unit, null);
    const bot = makeNeighbor({ type: PlayerType.Bot, units: [unit] });
    const player = makePlayer([], [bot]);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("excludes non-player neighbors", () => {
    const unit = makeUnit(40);
    const station = makeStation(unit, null);
    const nonPlayer = makeNeighbor({ isPlayer: false, units: [unit] });
    const player = makePlayer([], [nonPlayer]);
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("excludes embargoed (canTrade = false) neighbors", () => {
    const unit = makeUnit(50);
    const station = makeStation(unit, null);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], { canTrade: () => false });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("includes non-embargoed neutral neighbor with 'other' weight", () => {
    const unit = makeUnit(60);
    const cluster = new Cluster();
    const station = makeStation(unit, cluster);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], {
      canTrade: () => true,
      isOnSameTeam: () => false,
      isAlliedWith: () => false,
    });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].tile).toBe(60);
    expect(result[0].cluster).toBe(cluster);
    expect(result[0].weight).toBeCloseTo(otherWeight);
  });

  it("uses 'ally' weight for allied neighbor", () => {
    const unit = makeUnit(70);
    const station = makeStation(unit, null);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], {
      canTrade: () => true,
      isOnSameTeam: () => false,
      isAlliedWith: (n) => n === neighbor,
    });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].weight).toBeCloseTo(allyWeight);
  });

  it("uses 'team' weight for team neighbor (team check precedes ally)", () => {
    const unit = makeUnit(80);
    const station = makeStation(unit, null);
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor], {
      canTrade: () => true,
      isOnSameTeam: (n) => n === neighbor,
      isAlliedWith: () => false,
    });
    const behavior = makeBehavior(makeGame([station]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(1);
    expect(result[0].weight).toBeCloseTo(teamWeight);
  });

  it("excludes neighbor units not registered in the station manager", () => {
    const unit = makeUnit(90);
    // Station manager has no stations, so unit is unknown
    const neighbor = makeNeighbor({ units: [unit] });
    const player = makePlayer([], [neighbor]);
    const behavior = makeBehavior(makeGame([]), player);

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(0);
  });

  it("collects own and neighbor units together", () => {
    const ownUnit = makeUnit(100);
    const ownStation = makeStation(ownUnit, null);
    const neighborUnit = makeUnit(200);
    const neighborStation = makeStation(neighborUnit, null);
    const neighbor = makeNeighbor({ units: [neighborUnit] });
    const player = makePlayer([ownUnit], [neighbor]);
    const behavior = makeBehavior(
      makeGame([ownStation, neighborStation]),
      player,
    );

    const result = (behavior as any).buildReachableStations();

    expect(result).toHaveLength(2);
    const tiles = result.map((r: any) => r.tile).sort();
    expect(tiles).toEqual([100, 200]);
  });
});

// ── getOrBuildReachableStations cache behaviour ──────────────────────────────

describe("NationStructureBehavior.getOrBuildReachableStations", () => {
  let behavior: NationStructureBehavior;
  let buildSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const player = makePlayer([], []);
    behavior = makeBehavior(makeGame(), player);
    buildSpy = vi.spyOn(behavior as any, "buildReachableStations");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls buildReachableStations exactly once on first access", () => {
    (behavior as any).getOrBuildReachableStations();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the same array instance on repeated calls", () => {
    const first = (behavior as any).getOrBuildReachableStations();
    const second = (behavior as any).getOrBuildReachableStations();

    expect(first).toBe(second);
  });

  it("does not call buildReachableStations a second time when cache is warm", () => {
    (behavior as any).getOrBuildReachableStations();
    (behavior as any).getOrBuildReachableStations();

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds after the cache is reset to null", () => {
    (behavior as any).getOrBuildReachableStations();
    (behavior as any).reachableStationsCache = null;
    (behavior as any).getOrBuildReachableStations();

    expect(buildSpy).toHaveBeenCalledTimes(2);
  });
});

// ── handleStructures build order (JumpGate) ──────────────────────────────────

function makeOrderGame(disabled: Set<UnitType> = new Set()): any {
  return {
    config: () => ({
      isUnitDisabled: (t: UnitType) => disabled.has(t),
      gameConfig: () => ({ difficulty: Difficulty.Medium }),
    }),
    // A coastal tile keeps Spaceport in the build order so the loop is complete.
    isVoidShore: () => true,
  };
}

function makeOrderPlayer(): any {
  return {
    unitsOwned: () => 0,
    borderTiles: () => new Set([1]),
  };
}

describe("NationStructureBehavior.handleStructures build order", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scores JumpGate immediately after OrbitalStrikePlatform", () => {
    const behavior = makeBehavior(makeOrderGame(), makeOrderPlayer());
    const order: UnitType[] = [];
    vi.spyOn(behavior as any, "shouldBuildStructure").mockImplementation(
      (type: UnitType) => {
        order.push(type);
        return false;
      },
    );
    vi.spyOn(behavior as any, "maybeSpawnStructure").mockReturnValue(false);

    behavior.handleStructures();

    expect(order).toContain(UnitType.JumpGate);
    expect(order).toContain(UnitType.OrbitalStrikePlatform);
    expect(order.indexOf(UnitType.JumpGate)).toBe(
      order.indexOf(UnitType.OrbitalStrikePlatform) + 1,
    );
  });

  it("skips JumpGate entirely when the unit type is disabled", () => {
    const behavior = makeBehavior(
      makeOrderGame(new Set([UnitType.JumpGate])),
      makeOrderPlayer(),
    );
    const order: UnitType[] = [];
    vi.spyOn(behavior as any, "shouldBuildStructure").mockImplementation(
      (type: UnitType) => {
        order.push(type);
        return false;
      },
    );
    vi.spyOn(behavior as any, "maybeSpawnStructure").mockReturnValue(false);

    behavior.handleStructures();

    expect(order).not.toContain(UnitType.JumpGate);
    expect(order).toContain(UnitType.OrbitalStrikePlatform);
  });

  it("builds a higher-priority structure before reaching JumpGate (non-regression)", () => {
    const behavior = makeBehavior(makeOrderGame(), makeOrderPlayer());
    const built: UnitType[] = [];
    vi.spyOn(behavior as any, "shouldBuildStructure").mockReturnValue(true);
    vi.spyOn(behavior as any, "maybeSpawnStructure").mockImplementation(
      (type: UnitType) => {
        built.push(type);
        return true;
      },
    );

    const result = behavior.handleStructures();

    // The first build-order entry wins and the loop returns before JumpGate.
    expect(result).toBe(true);
    expect(built).toEqual([UnitType.DefenseStation]);
    expect(built).not.toContain(UnitType.JumpGate);
  });
});

// ── JumpGate ratio threshold ─────────────────────────────────────────────────

function makeRatioGame(): any {
  return {
    config: () => ({
      gameConfig: () => ({ difficulty: Difficulty.Medium }),
    }),
  };
}

function makeRatioPlayer(jumpGatesOwned: number): any {
  return {
    unitsOwned: (t: UnitType) => (t === UnitType.JumpGate ? jumpGatesOwned : 0),
    numTilesOwned: () => 100_000,
  };
}

describe("NationStructureBehavior JumpGate ratio threshold", () => {
  it("builds another JumpGate while owned count is below the colony ratio", () => {
    // 20 colonies * 0.2 ratio => target 4; 3 owned is still below target.
    const behavior = makeBehavior(makeRatioGame(), makeRatioPlayer(3));
    expect(
      (behavior as any).shouldBuildStructure(UnitType.JumpGate, 20, false),
    ).toBe(true);
  });

  it("stops building JumpGates once the colony ratio target is met", () => {
    // 20 colonies * 0.2 ratio => target 4; 4 owned reaches the target.
    const behavior = makeBehavior(makeRatioGame(), makeRatioPlayer(4));
    expect(
      (behavior as any).shouldBuildStructure(UnitType.JumpGate, 20, false),
    ).toBe(false);
  });
});

// ── JumpGate perceived cost scaling ──────────────────────────────────────────

function makeCostGame(
  costs: Partial<Record<UnitType, bigint>>,
  disabled: Set<UnitType>,
): any {
  return {
    config: () => ({
      isUnitDisabled: (t: UnitType) => disabled.has(t),
      gameConfig: () => ({ difficulty: Difficulty.Medium }),
    }),
    unitInfo: (t: UnitType) => ({ cost: () => costs[t] ?? 0n }),
  };
}

function makeCostPlayer(credits: bigint, jumpGatesOwned: number): any {
  return {
    credits: () => credits,
    unitsOwned: (t: UnitType) => (t === UnitType.JumpGate ? jumpGatesOwned : 0),
  };
}

describe("NationStructureBehavior JumpGate perceived cost", () => {
  // ClusterWarhead + NovaBomb disabled => save-up target is 20 antimatter
  // torpedoes => 100 * 20 = 2000 credits.
  const disabled = new Set([UnitType.ClusterWarhead, UnitType.NovaBomb]);
  const costs: Partial<Record<UnitType, bigint>> = {
    [UnitType.JumpGate]: 1000n,
    [UnitType.AntimatterTorpedo]: 100n,
  };

  it("inflates perceived cost by 100% per owned JumpGate while saving up", () => {
    const game = makeCostGame(costs, disabled);

    const owned0 = makeBehavior(game, makeCostPlayer(500n, 0));
    expect((owned0 as any).getPerceivedCost(UnitType.JumpGate)).toBe(1000n);

    const owned2 = makeBehavior(game, makeCostPlayer(500n, 2));
    // realCost * (1 + increasePerOwned * owned) = 1000 * (1 + 1 * 2) = 3000
    expect((owned2 as any).getPerceivedCost(UnitType.JumpGate)).toBe(3000n);
  });

  it("does not inflate perceived cost once the save-up target is reached", () => {
    const game = makeCostGame(costs, disabled);
    // 5000 credits >= 2000 save-up target => real cost is used unchanged.
    const behavior = makeBehavior(game, makeCostPlayer(5000n, 2));
    expect((behavior as any).getPerceivedCost(UnitType.JumpGate)).toBe(1000n);
  });
});

// ── JumpGate placement scoring ───────────────────────────────────────────────

const SELF_ID = 1;
const HOSTILE_ID = 2;

/** Tile encoding for the placement mocks: a TileRef is x * 1000 + y. */
const REF = (x: number, y: number): number => x * 1000 + y;
const TX = (t: number): number => Math.floor(t / 1000);
const TY = (t: number): number => t % 1000;

function makePlacementGame(hostileTiles: Set<number> = new Set()): any {
  const hostilePlayer = { isPlayer: () => true };
  const selfPlayer = { isPlayer: () => true };
  return {
    config: () => ({
      nukeMagnitudes: () => ({ outer: 10 }),
    }),
    magnitude: () => 0,
    manhattanDist: (a: number, b: number) =>
      Math.abs(TX(a) - TX(b)) + Math.abs(TY(a) - TY(b)),
    x: (t: number) => TX(t),
    y: (t: number) => TY(t),
    ref: (x: number, y: number) => REF(x, y),
    isValidCoord: () => true,
    isSector: () => true,
    neighbors: (t: number) =>
      (
        [
          [TX(t) + 1, TY(t)],
          [TX(t) - 1, TY(t)],
          [TX(t), TY(t) + 1],
          [TX(t), TY(t) - 1],
        ] as Array<[number, number]>
      )
        .filter(([x, y]) => x >= 0 && y >= 0)
        .map(([x, y]) => REF(x, y)),
    ownerID: (t: number) => (hostileTiles.has(t) ? HOSTILE_ID : SELF_ID),
    playerBySmallID: (id: number) =>
      id === HOSTILE_ID ? hostilePlayer : selfPlayer,
  };
}

function makePlacementPlayer(opts: {
  borderTiles: number[];
  gates?: number[];
  bbox?: { min: { x: number; y: number }; max: { x: number; y: number } };
}): any {
  return {
    smallID: () => SELF_ID,
    borderTiles: () => new Set(opts.borderTiles),
    units: () => (opts.gates ?? []).map((t) => makeUnit(t)),
    largestClusterBoundingBox: opts.bbox,
    isFriendly: () => false,
    relation: () => Relation.Hostile,
  };
}

describe("NationStructureBehavior.jumpGateValue placement", () => {
  it("places the first gate in the interior near the cluster centroid", () => {
    const game = makePlacementGame();
    const player = makePlacementPlayer({
      borderTiles: [REF(0, 0), REF(0, 5), REF(0, 10)],
      gates: [],
      bbox: { min: { x: 50, y: 5 }, max: { x: 50, y: 5 } },
    });
    const behavior = makeBehavior(game, player);
    const valueFn = (behavior as any).jumpGateValue();

    const interiorTile = REF(50, 5);
    const borderTile = REF(1, 5);
    expect(valueFn(interiorTile)).toBeGreaterThan(valueFn(borderTile));
  });

  it("biases later gates toward the hostile frontier when one exists", () => {
    // REF(9, 10) is a hostile-owned neighbor of border tile REF(10, 10).
    const game = makePlacementGame(new Set([REF(9, 10)]));
    const player = makePlacementPlayer({
      borderTiles: [REF(10, 10), REF(10, 200)],
      gates: [REF(50, 5)],
    });
    const behavior = makeBehavior(game, player);
    const valueFn = (behavior as any).jumpGateValue();

    const hostileFrontierTile = REF(20, 10);
    const peacefulFrontierTile = REF(20, 200);
    expect(valueFn(hostileFrontierTile)).toBeGreaterThan(
      valueFn(peacefulFrontierTile),
    );
  });

  it("falls back to interior placement for later gates with no hostile frontier", () => {
    // No hostile tiles => hasHostileFrontier() is false => interior heuristic
    // is used instead of border-hugging the only (peaceful) frontier.
    const game = makePlacementGame();
    const player = makePlacementPlayer({
      borderTiles: [REF(0, 0), REF(0, 5), REF(0, 10)],
      gates: [REF(99, 99)],
      bbox: { min: { x: 50, y: 5 }, max: { x: 50, y: 5 } },
    });
    const behavior = makeBehavior(game, player);
    const valueFn = (behavior as any).jumpGateValue();

    const interiorTile = REF(50, 5);
    const borderHuggingTile = REF(1, 5);
    expect(valueFn(interiorTile)).toBeGreaterThan(valueFn(borderHuggingTile));
  });
});
