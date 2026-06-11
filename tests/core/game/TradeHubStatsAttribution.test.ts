import { vi, type Mocked } from "vitest";
import { FrigateExecution } from "../../../src/core/execution/FrigateExecution";
import { Game, Player, Unit, UnitType } from "../../../src/core/game/Game";
import { TradeHub } from "../../../src/core/game/TradeHub";

vi.mock("../../../src/core/game/Game");
vi.mock("../../../src/core/execution/FrigateExecution");
vi.mock("../../../src/core/PseudoRandom");

/**
 * Regression test: when a frigate stops at a station owned by ANOTHER
 * player, the external-trade stat entry must be attributed to the station
 * owner (who earned credits from someone else's frigate), not to the
 * frigate owner. The bug recorded both buckets against the frigate owner,
 * double-counting their income and never crediting the station owner.
 */
describe("TradeHub — frigate stop stats attribution", () => {
  let game: Mocked<Game>;
  let stats: { frigateExternalTrade: any; frigateSelfTrade: any };
  let stationOwner: Mocked<Player>;
  let trainOwner: Mocked<Player>;
  let unit: Mocked<Unit>;
  let trainExecution: Mocked<FrigateExecution>;

  beforeEach(() => {
    stats = {
      frigateExternalTrade: vi.fn(),
      frigateSelfTrade: vi.fn(),
    };
    game = {
      ticks: vi.fn().mockReturnValue(123),
      config: vi.fn().mockReturnValue({
        frigateCredits: () => 500n,
      }),
      addUpdate: vi.fn(),
      addExecution: vi.fn(),
      stats: vi.fn().mockReturnValue(stats),
    } as any;

    stationOwner = {
      addCredits: vi.fn(),
      id: vi.fn().mockReturnValue(1),
      canTrade: vi.fn().mockReturnValue(true),
      isOnSameTeam: vi.fn().mockReturnValue(false),
      isAlliedWith: vi.fn().mockReturnValue(false),
    } as any;
    trainOwner = {
      addCredits: vi.fn(),
      id: vi.fn().mockReturnValue(2),
      canTrade: vi.fn().mockReturnValue(true),
      isOnSameTeam: vi.fn().mockReturnValue(false),
      isAlliedWith: vi.fn().mockReturnValue(false),
    } as any;

    unit = {
      owner: vi.fn().mockReturnValue(stationOwner),
      level: vi.fn().mockReturnValue(1),
      tile: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      type: vi.fn().mockReturnValue(UnitType.Colony),
      isActive: vi.fn().mockReturnValue(true),
    } as any;

    trainExecution = {
      owner: vi.fn().mockReturnValue(trainOwner),
      tradeStopsVisited: vi.fn().mockReturnValue(0),
    } as any;
  });

  it("records external-trade earnings against the station owner", () => {
    const station = new TradeHub(game, unit);

    station.onFrigateStop(trainExecution);

    // Both players are paid...
    expect(stationOwner.addCredits).toHaveBeenCalledWith(500n, unit.tile());
    expect(trainOwner.addCredits).toHaveBeenCalledWith(500n, unit.tile());
    // ...and each stat bucket belongs to the player who earned it.
    expect(stats.frigateExternalTrade).toHaveBeenCalledTimes(1);
    expect(stats.frigateExternalTrade).toHaveBeenCalledWith(stationOwner, 500n);
    expect(stats.frigateSelfTrade).toHaveBeenCalledTimes(1);
    expect(stats.frigateSelfTrade).toHaveBeenCalledWith(trainOwner, 500n);
  });

  it("records only a self-trade entry when the frigate owner owns the station", () => {
    (unit.owner as any).mockReturnValue(trainOwner);
    const station = new TradeHub(game, unit);

    station.onFrigateStop(trainExecution);

    expect(stats.frigateExternalTrade).not.toHaveBeenCalled();
    expect(stats.frigateSelfTrade).toHaveBeenCalledTimes(1);
    expect(stats.frigateSelfTrade).toHaveBeenCalledWith(trainOwner, 500n);
  });
});
