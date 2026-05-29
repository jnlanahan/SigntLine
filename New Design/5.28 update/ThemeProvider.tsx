// sightline/ThemeProvider.tsx
import React, { createContext, useContext, useMemo } from "react";
import { AccentName, SightLineTheme, makeTheme } from "./theme";

const ThemeCtx = createContext<SightLineTheme>(makeTheme("lime"));

/** Read the active SightLine theme inside any component. */
export const useTheme = (): SightLineTheme => useContext(ThemeCtx);

/**
 * Wrap a SightLine surface to set its accent. Every panel also accepts an
 * `accent` prop, which wraps itself in this provider — so you can theme one
 * panel or a whole subtree.
 */
export function SightLineTheme({
  accent = "lime",
  children,
}: {
  accent?: AccentName;
  children: React.ReactNode;
}) {
  const theme = useMemo(() => makeTheme(accent), [accent]);
  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;
}
