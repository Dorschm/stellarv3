// @vitest-environment node
//
// Same node-env + hand-rolled window stub approach as
// SpaceInputHandler.HostOnly.test.ts: the project's jsdom environment is
// currently incompatible with its Node toolchain, so we stub the few
// globals SpaceInputHandler.initialize() reaches for.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

class FakeEventTarget {
  private listeners = new Map<string, Set<(e: any) => void>>();
  addEventListener(type: string, fn: (e: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(event: { type: string }): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const fn of set) fn(event);
    return true;
  }
}

class FakeKeyboardEvent {
  type: string;
  code: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: any;
  constructor(type: string, init: any = {}) {
    this.type = type;
    this.code = init.code ?? "";
    this.repeat = init.repeat ?? false;
    this.altKey = init.altKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.target = init.target ?? null;
  }
  preventDefault(): void {}
}

class FakeCustomEvent<T = any> {
  type: string;
  detail: T;
  constructor(type: string, init: { detail: T }) {
    this.type = type;
    this.detail = init.detail;
  }
}

const fakeWindow = new FakeEventTarget() as unknown as Window;
(fakeWindow as any).innerWidth = 1024;
(fakeWindow as any).innerHeight = 768;

(globalThis as any).window = fakeWindow;
(globalThis as any).KeyboardEvent = FakeKeyboardEvent as any;
(globalThis as any).CustomEvent = FakeCustomEvent as any;
(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
(globalThis as any).document = {
  querySelector: () => null,
};

// Imports after the globals are defined so the modules' top-level reads
// (Platform.isMac, etc.) see the stubs.
import { useHUDStore } from "../../../src/client/bridge/HUDStore";
import { SpaceInputHandler } from "../../../src/client/bridge/SpaceInputHandler";
import { SwapRocketDirectionEvent } from "../../../src/client/InputHandler";
import { EventBus } from "../../../src/core/EventBus";

/**
 * Regression: the swap-direction hotkey used to toggle a private
 * `rocketDirectionUp` field inside SpaceInputHandler, which desynced from
 * the HUD store whenever the PlayerPanel "Flip rocket trajectory" button
 * flipped the store directly — the next hotkey press then re-emitted the
 * value the store already held (a visible no-op). The handler now derives
 * the next value from the HUD store, the single source of truth.
 */
describe("SpaceInputHandler — rocket-direction hotkey syncs with HUD store", () => {
  let bus: EventBus;
  let handler: SpaceInputHandler;
  let emitted: boolean[];

  beforeEach(() => {
    useHUDStore.getState().reset();
    bus = new EventBus();
    handler = new SpaceInputHandler(bus);
    handler.initialize();

    emitted = [];
    // Mirror production wiring: GameBridge.onSwapRocketDirection writes
    // every SwapRocketDirectionEvent back into the HUD store.
    bus.on(SwapRocketDirectionEvent, (e) => {
      emitted.push(e.rocketDirectionUp);
      useHUDStore.getState().setRocketDirectionUp(e.rocketDirectionUp);
    });
  });

  afterEach(() => {
    handler.destroy();
    useHUDStore.getState().reset();
  });

  function pressSwapHotkey() {
    // Default keybind for swapDirection is KeyU, handled on keyup.
    (window as any).dispatchEvent(
      new (globalThis as any).KeyboardEvent("keyup", { code: "KeyU" }),
    );
  }

  test("hotkey flips the direction on every press", () => {
    expect(useHUDStore.getState().rocketDirectionUp).toBe(true);

    pressSwapHotkey();
    expect(useHUDStore.getState().rocketDirectionUp).toBe(false);

    pressSwapHotkey();
    expect(useHUDStore.getState().rocketDirectionUp).toBe(true);

    expect(emitted).toEqual([false, true]);
  });

  test("hotkey still flips after a PlayerPanel toggle (no dead keypress)", () => {
    // Hotkey: true -> false.
    pressSwapHotkey();
    expect(useHUDStore.getState().rocketDirectionUp).toBe(false);

    // PlayerPanel "Flip rocket trajectory" button: reads the store and
    // emits the swap event (PlayerPanel.handleToggleRocketDirection).
    bus.emit(
      new SwapRocketDirectionEvent(!useHUDStore.getState().rocketDirectionUp),
    );
    expect(useHUDStore.getState().rocketDirectionUp).toBe(true);

    // Next hotkey press must flip again (true -> false). Before the fix
    // the handler's stale private copy made this press emit `true` — the
    // value the store already held — so the keypress did nothing.
    pressSwapHotkey();
    expect(useHUDStore.getState().rocketDirectionUp).toBe(false);

    expect(emitted).toEqual([false, true, false]);
  });
});
