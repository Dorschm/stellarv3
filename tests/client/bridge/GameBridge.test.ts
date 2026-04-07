// @vitest-environment node
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";
import {
  AttackRatioEvent,
  GhostStructureChangedEvent,
  SwapRocketDirectionEvent,
} from "../../../src/client/InputHandler";
import { useHUDStore } from "../../../src/client/bridge/HUDStore";
import { GameBridge } from "../../../src/client/bridge/GameBridge";

/**
 * Minimal mock of GameView — GameBridge.tick() is not exercised here, so
 * only the constructor shape matters.
 */
function makeMockGameView(): any {
  return {
    ticks: () => 0,
    inSpawnPhase: () => false,
    players: () => [],
    myPlayer: () => null,
    units: () => [],
    updatesSinceLastTick: () => null,
  };
}

describe("GameBridge EventBus → HUDStore synchronisation", () => {
  let eventBus: EventBus;
  let bridge: GameBridge;

  beforeEach(() => {
    // Reset the store to a clean slate before each test.
    useHUDStore.getState().reset();
    eventBus = new EventBus();
    bridge = new GameBridge(makeMockGameView(), "test-client");
    bridge.initialize(eventBus);
  });

  afterEach(() => {
    bridge.destroy();
  });

  // -------------------------------------------------------------------
  // Regression: keyboard build hotkey → store update → click-to-place
  // -------------------------------------------------------------------

  test("GhostStructureChangedEvent updates HUDStore.ghostStructure", () => {
    expect(useHUDStore.getState().ghostStructure).toBeNull();

    eventBus.emit(new GhostStructureChangedEvent(UnitType.City));
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.City);

    eventBus.emit(new GhostStructureChangedEvent(UnitType.Factory));
    expect(useHUDStore.getState().ghostStructure).toBe(UnitType.Factory);

    eventBus.emit(new GhostStructureChangedEvent(null));
    expect(useHUDStore.getState().ghostStructure).toBeNull();
  });

  test("build hotkey selection is readable before inputEvent reads the store", () => {
    // Simulate the sequence: keyboard hotkey emits event → bridge syncs →
    // ClientGameRunner.inputEvent() reads useHUDStore.getState().ghostStructure.
    eventBus.emit(new GhostStructureChangedEvent(UnitType.MissileSilo));

    // This is exactly what ClientGameRunner.inputEvent() does:
    const ghostStructure = useHUDStore.getState().ghostStructure;
    expect(ghostStructure).toBe(UnitType.MissileSilo);
  });

  // -------------------------------------------------------------------
  // AttackRatioEvent
  // -------------------------------------------------------------------

  test("AttackRatioEvent increments attackRatio in HUDStore", () => {
    expect(useHUDStore.getState().attackRatio).toBe(20); // default

    eventBus.emit(new AttackRatioEvent(5));
    expect(useHUDStore.getState().attackRatio).toBe(25);

    eventBus.emit(new AttackRatioEvent(-10));
    expect(useHUDStore.getState().attackRatio).toBe(15);
  });

  test("AttackRatioEvent clamps to [0, 100]", () => {
    useHUDStore.getState().setAttackRatio(95);
    eventBus.emit(new AttackRatioEvent(20));
    expect(useHUDStore.getState().attackRatio).toBe(100);

    useHUDStore.getState().setAttackRatio(5);
    eventBus.emit(new AttackRatioEvent(-20));
    expect(useHUDStore.getState().attackRatio).toBe(0);
  });

  // -------------------------------------------------------------------
  // SwapRocketDirectionEvent
  // -------------------------------------------------------------------

  test("SwapRocketDirectionEvent updates rocketDirectionUp in HUDStore", () => {
    expect(useHUDStore.getState().rocketDirectionUp).toBe(true);

    eventBus.emit(new SwapRocketDirectionEvent(false));
    expect(useHUDStore.getState().rocketDirectionUp).toBe(false);

    eventBus.emit(new SwapRocketDirectionEvent(true));
    expect(useHUDStore.getState().rocketDirectionUp).toBe(true);
  });

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  test("destroy() stops syncing events to the store", () => {
    bridge.destroy();

    eventBus.emit(new GhostStructureChangedEvent(UnitType.Port));
    expect(useHUDStore.getState().ghostStructure).toBeNull();
  });
});

describe("HUDStore reset", () => {
  beforeEach(() => {
    useHUDStore.getState().reset();
  });

  test("reset restores all slices to initial defaults", () => {
    // Mutate several slices
    const store = useHUDStore.getState();
    store.setGhostStructure(UnitType.AtomBomb);
    store.setAttackRatio(75);
    store.setRocketDirectionUp(false);
    store.setWinner({ winner: 1 } as any);
    store.addMessages([
      {
        id: 999,
        message: "test",
        messageType: 0 as any,
        playerID: null,
        tick: 42,
      },
    ]);

    // Reset
    useHUDStore.getState().reset();

    const after = useHUDStore.getState();
    expect(after.ghostStructure).toBeNull();
    expect(after.attackRatio).toBe(20);
    expect(after.rocketDirectionUp).toBe(true);
    expect(after.winner).toBeNull();
    expect(after.messages).toEqual([]);
    expect(after.ticks).toBe(0);
    expect(after.myPlayer).toBeNull();
    expect(after.selectedTile).toBeNull();
    expect(after.inSpawnPhase).toBe(false);
    expect(after.players.size).toBe(0);
    expect(after.units.size).toBe(0);
  });

  test("reset provides fresh collection instances", () => {
    const store = useHUDStore.getState();
    const oldPlayers = store.players;
    const oldUnits = store.units;
    const oldMessages = store.messages;

    store.reset();

    const after = useHUDStore.getState();
    expect(after.players).not.toBe(oldPlayers);
    expect(after.units).not.toBe(oldUnits);
    expect(after.messages).not.toBe(oldMessages);
  });
});
