import { createContext, useContext } from "react";
import { UserSettings } from "../../core/game/UserSettings";

export interface TransformContextValue {
  userSettings: UserSettings;
}

export const TransformContext = createContext<TransformContextValue | null>(
  null,
);

/**
 * Access UserSettings from the React context.
 * Returns null when no provider is mounted (safe to call unconditionally).
 */
export function useTransform(): TransformContextValue | null {
  return useContext(TransformContext);
}
