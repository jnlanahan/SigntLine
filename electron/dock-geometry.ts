// Pure geometry for the docked-sidebar (AppBar) feature — no electron
// imports so it stays unit-testable from vitest (like calibrate-detect.ts).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DockSide = "left" | "right";

// Expanded-sidebar width limits (DIP). The rail is a separate fixed width —
// callers pass it explicitly, so clampDockWidth only guards the expanded form.
export const DOCK_WIDTH_DEFAULT = 400;
export const DOCK_WIDTH_MIN = 340;
export const DOCK_WIDTH_MAX = 520;
export const RAIL_WIDTH = 64;

export function clampDockWidth(width: number): number {
  if (!Number.isFinite(width)) return DOCK_WIDTH_DEFAULT;
  return Math.round(
    Math.max(DOCK_WIDTH_MIN, Math.min(DOCK_WIDTH_MAX, width)),
  );
}

/**
 * The full-height strip the sidebar reserves on a display. `width` is used
 * as-is (rail callers pass RAIL_WIDTH) but never wider than the display.
 */
export function computeDockRect(
  displayBounds: Rect,
  side: DockSide,
  width: number,
): Rect {
  const w = Math.max(1, Math.min(Math.round(width), displayBounds.width));
  return {
    x:
      side === "left"
        ? displayBounds.x
        : displayBounds.x + displayBounds.width - w,
    y: displayBounds.y,
    width: w,
    height: displayBounds.height,
  };
}

/**
 * The desktop area left over after the dock strip is reserved. If the strip
 * doesn't overlap this display (docked elsewhere, stale rect), the full
 * bounds come back unchanged — subtraction must never invent a hole.
 */
export function subtractDockStrip(displayBounds: Rect, dockRect: Rect): Rect {
  const overlapX = Math.max(
    0,
    Math.min(
      displayBounds.x + displayBounds.width,
      dockRect.x + dockRect.width,
    ) - Math.max(displayBounds.x, dockRect.x),
  );
  const overlapY = Math.max(
    0,
    Math.min(
      displayBounds.y + displayBounds.height,
      dockRect.y + dockRect.height,
    ) - Math.max(displayBounds.y, dockRect.y),
  );
  if (overlapX <= 0 || overlapY <= 0) return { ...displayBounds };

  // The strip hugs whichever display edge it's closer to.
  const leftGap = dockRect.x - displayBounds.x;
  const rightGap =
    displayBounds.x + displayBounds.width - (dockRect.x + dockRect.width);
  const docksLeft = leftGap <= rightGap;
  const remaining = Math.max(1, displayBounds.width - overlapX);
  return docksLeft
    ? {
        x: displayBounds.x + overlapX,
        y: displayBounds.y,
        width: remaining,
        height: displayBounds.height,
      }
    : {
        x: displayBounds.x,
        y: displayBounds.y,
        width: remaining,
        height: displayBounds.height,
      };
}
