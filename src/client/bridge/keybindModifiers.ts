import { Platform } from "../Platform";

/**
 * Shared keybind-configuration loader and modifier-key resolvers.
 *
 * InputHandler and SpaceInputHandler both persist a `settings.keybinds` blob
 * to localStorage and read two slots from it — `modifierKey` (for the build
 * menu click) and `altKey` (for the emoji menu click). These can be any of
 * Control/Alt/Shift/Meta on either side.
 *
 * SpaceMapPlane (the R3F map mesh) needs to honour the same configuration so
 * that ctrl/alt-click on the map matches what the key handlers expect. This
 * module centralises that logic so the three sites stay in sync.
 */

/** Minimal event shape that carries the four modifier flags we care about. */
export interface ModifierEvent {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Loads the keybind map from localStorage, merging saved values over the
 * platform-aware defaults. Mirrors the loader used by InputHandler and
 * SpaceInputHandler so all three paths resolve modifier keys identically.
 */
export function loadKeybinds(): Record<string, string> {
  let saved: Record<string, string> = {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem("settings.keybinds") ?? "{}",
    );
    // flatten { key: {key, value} } → { key: value } and accept legacy string values
    saved = Object.fromEntries(
      Object.entries(parsed)
        .map(([k, v]) => {
          let val: unknown;
          if (v && typeof v === "object" && "value" in v) {
            val = (v as { value: unknown }).value;
          } else {
            val = v;
          }
          if (typeof val !== "string") return [k, undefined];
          return [k, val];
        })
        .filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } catch (e) {
    console.warn("Invalid keybinds JSON:", e);
  }

  const isMac = Platform.isMac;

  return {
    modifierKey: isMac ? "MetaLeft" : "ControlLeft",
    altKey: "AltLeft",
    ...saved,
  };
}

/**
 * Returns true when the configured `modifierKey` binding is currently held
 * on the supplied event. Mirrors InputHandler.isModifierKeyPressed.
 */
export function isModifierKeyPressed(
  event: ModifierEvent,
  keybinds: Record<string, string>,
): boolean {
  const bind = keybinds.modifierKey;
  return (
    ((bind === "AltLeft" || bind === "AltRight") && event.altKey) ||
    ((bind === "ControlLeft" || bind === "ControlRight") && event.ctrlKey) ||
    ((bind === "ShiftLeft" || bind === "ShiftRight") && event.shiftKey) ||
    ((bind === "MetaLeft" || bind === "MetaRight") && event.metaKey)
  );
}

/**
 * Returns true when the configured `altKey` binding is currently held on the
 * supplied event. Mirrors InputHandler.isAltKeyPressed.
 */
export function isAltKeyPressed(
  event: ModifierEvent,
  keybinds: Record<string, string>,
): boolean {
  const bind = keybinds.altKey;
  return (
    ((bind === "AltLeft" || bind === "AltRight") && event.altKey) ||
    ((bind === "ControlLeft" || bind === "ControlRight") && event.ctrlKey) ||
    ((bind === "ShiftLeft" || bind === "ShiftRight") && event.shiftKey) ||
    ((bind === "MetaLeft" || bind === "MetaRight") && event.metaKey)
  );
}
