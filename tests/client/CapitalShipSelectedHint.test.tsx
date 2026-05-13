// @vitest-environment node
//
// Issue #4 — smoke coverage for the selected-capital-ship HUD hint. We can't
// easily mount React under the project's node test environment (the jsdom
// stack is wedged on @exodus/bytes, see HostLobbyModal.test.tsx), so we
// stub `useHUDStore` to return a deterministic selection id and exercise
// the conditional return path directly.

import React from "react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../src/client/bridge/HUDStore", () => ({
  useHUDStore: vi.fn(),
}));

import { useHUDStore } from "../../src/client/bridge/HUDStore";
import { CapitalShipSelectedHint } from "../../src/client/hud/CapitalShipSelectedHint";

const mockUseHUDStore = useHUDStore as unknown as ReturnType<typeof vi.fn>;

describe("CapitalShipSelectedHint", () => {
  test("renders nothing when no capital ship is selected", () => {
    mockUseHUDStore.mockImplementation((selector: any) =>
      selector({ selectedBattlecruiserUnitId: null }),
    );
    expect(CapitalShipSelectedHint()).toBeNull();
  });

  test("renders the hint element when a capital ship is selected", () => {
    mockUseHUDStore.mockImplementation((selector: any) =>
      selector({ selectedBattlecruiserUnitId: 42 }),
    );
    const element = CapitalShipSelectedHint() as React.ReactElement | null;
    expect(element).not.toBeNull();
    // The hint advertises the three actions the player can take next.
    const html = JSON.stringify(element);
    expect(html).toContain("Capital ship selected");
    expect(html).toContain("Esc");
    expect(html).toContain("capital-ship-selected-hint");
  });
});
