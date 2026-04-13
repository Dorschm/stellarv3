/**
 * Format a raw {@link Planet.resourceModifier} value as a compact multiplier
 * readout (e.g. `1.372` → `×1.37`). Lives in its own module so unit tests can
 * cover it without pulling in the Three.js / @react-three toolchain that
 * {@link PlanetLandmarks} depends on.
 */
export function formatResourceModifier(modifier: number): string {
  if (!Number.isFinite(modifier)) return "";
  return `\u00d7${modifier.toFixed(2)}`;
}
