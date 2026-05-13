// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  PlayerSnapshot,
  UnitSnapshot,
  useHUDStore,
} from "../../../src/client/bridge/HUDStore";
import { SpaceInputHandler } from "../../../src/client/bridge/SpaceInputHandler";
import { GhostStructureChangedEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { PlayerType, UnitType } from "../../../src/core/game/Game";

/**
 * Issue #7 — verify the selected-cruiser hotkey path in SpaceInputHandler
 * dispatches a "Not enough money" rejection toast when the player cannot
 * afford the hosted structure, instead of silently bouncing on the server
 * (its previous behavior — see the verification comment on issue #7).
 *
 * We exercise the real `onKeyUp` handler via a dispatched KeyboardEvent so
 * the production code path (hotkey resolution + HUDStore read + dispatch)
 * is covered end-to-end. The HUDStore is preloaded with a selected
 * empty-slot Battlecruiser owned by the local player and a cost map that
 * exceeds the player's credit balance.
 */

const CRUISER_ID = 7777;
const MY_SMALL_ID = 1;
const COST = 100n;

function makeMyPlayer(credits: bigint): PlayerSnapshot {
  return {
    id: "pilot",
    smallID: MY_SMALL_ID,
    name: "pilot",
    displayName: "pilot",
    isAlive: true,
    population: 0,
    credits,
    numTilesOwned: 0,
    allies: [],
    isMe: true,
    playerType: PlayerType.Human,
    team: null,
  };
}

function makeCruiser(opts: { occupied: boolean }): UnitSnapshot {
  return {
    id: CRUISER_ID,
    type: UnitType.Battlecruiser,
    ownerSmallID: MY_SMALL_ID,
    tile: 1234,
    population: 0,
    level: 0,
    isActive: true,
    health: undefined,
    hasSlottedStructure: opts.occupied,
  };
}

function preloadHUD(opts: {
  credits: bigint;
  cost: bigint | undefined;
  occupied?: boolean;
}) {
  const hud = useHUDStore.getState();
  hud.reset();
  hud.setMyPlayer(makeMyPlayer(opts.credits));
  const units = new Map<number, any>();
  units.set(CRUISER_ID, makeCruiser({ occupied: opts.occupied === true }));
  hud.setUnits(units);
  hud.setSelectedBattlecruiser(CRUISER_ID);
  const costs = new Map<UnitType, bigint>();
  if (opts.cost !== undefined) {
    costs.set(UnitType.Colony, opts.cost);
  }
  hud.setCruiserHostableCosts(costs);
}

describe("SpaceInputHandler — selected-cruiser host-only hotkey feedback", () => {
  let bus: EventBus;
  let handler: SpaceInputHandler;
  let toastSpy: ReturnType<typeof vi.fn>;
  let buildIntents: BuildUnitIntentEvent[];
  let ghostChanges: (UnitType | null)[];

  beforeEach(() => {
    bus = new EventBus();
    handler = new SpaceInputHandler(bus);
    handler.initialize();

    buildIntents = [];
    ghostChanges = [];
    bus.on(BuildUnitIntentEvent, (e) => buildIntents.push(e));
    bus.on(GhostStructureChangedEvent, (e) =>
      ghostChanges.push(e.ghostStructure),
    );

    toastSpy = vi.fn();
    window.addEventListener("show-message", toastSpy as EventListener);
  });

  afterEach(() => {
    handler.destroy();
    window.removeEventListener("show-message", toastSpy as EventListener);
    useHUDStore.getState().reset();
  });

  test("insufficient credits dispatches a rejection toast and skips ghost fallback", () => {
    preloadHUD({ credits: 1n, cost: COST });

    // Digit1 = buildColony per default keybinds.
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Digit1" }));

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const evt = toastSpy.mock.calls[0][0] as CustomEvent;
    expect(evt.detail.color).toBe("red");
    expect(typeof evt.detail.message).toBe("string");
    expect(evt.detail.message.length).toBeGreaterThan(0);

    // No build intent was fired and no ground-placement ghost was set.
    expect(buildIntents).toHaveLength(0);
    expect(ghostChanges).toHaveLength(0);
  });

  test("sufficient credits emits the host-only BuildUnitIntent and no toast", () => {
    preloadHUD({ credits: COST, cost: COST });

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Digit1" }));

    expect(toastSpy).toHaveBeenCalledTimes(0);
    expect(buildIntents).toHaveLength(1);
    expect(buildIntents[0].unit).toBe(UnitType.Colony);
    // host-only path passes the cruiser id along
    expect((buildIntents[0] as any).hostBattlecruiserId).toBe(CRUISER_ID);
    expect(ghostChanges).toHaveLength(0);
  });

  test("full slot still wins over affordability (Slot occupied toast)", () => {
    preloadHUD({ credits: 1n, cost: COST, occupied: true });

    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Digit1" }));

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const msg = (toastSpy.mock.calls[0][0] as CustomEvent).detail.message;
    expect(String(msg)).toMatch(/slot/i);
    expect(buildIntents).toHaveLength(0);
    expect(ghostChanges).toHaveLength(0);
  });
});
