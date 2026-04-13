// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatResourceModifier } from "../../../src/client/scene/formatResourceModifier";

describe("formatResourceModifier", () => {
  it("renders a compact ×-prefixed multiplier with two decimals", () => {
    expect(formatResourceModifier(1.372)).toBe("\u00d71.37");
    expect(formatResourceModifier(0.5)).toBe("\u00d70.50");
    expect(formatResourceModifier(2)).toBe("\u00d72.00");
  });

  it("rounds to two decimals", () => {
    expect(formatResourceModifier(1.005)).toMatch(/^\u00d71\.\d{2}$/);
    expect(formatResourceModifier(1.999)).toBe("\u00d72.00");
  });

  it("returns empty string for non-finite input", () => {
    expect(formatResourceModifier(Number.NaN)).toBe("");
    expect(formatResourceModifier(Number.POSITIVE_INFINITY)).toBe("");
  });
});
