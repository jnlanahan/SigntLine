import { describe, expect, it } from "vitest";
import {
  clampDockWidth,
  computeDockRect,
  subtractDockStrip,
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_MIN,
  DOCK_WIDTH_MAX,
  RAIL_WIDTH,
} from "../../electron/dock-geometry";

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
// Secondary monitor to the left of primary — negative origin, the case that
// breaks naive "x starts at 0" math.
const LEFT_MONITOR = { x: -2560, y: -200, width: 2560, height: 1440 };

describe("clampDockWidth", () => {
  it("passes through in-range widths", () => {
    expect(clampDockWidth(400)).toBe(400);
    expect(clampDockWidth(DOCK_WIDTH_MIN)).toBe(DOCK_WIDTH_MIN);
    expect(clampDockWidth(DOCK_WIDTH_MAX)).toBe(DOCK_WIDTH_MAX);
  });

  it("clamps out-of-range and rejects garbage", () => {
    expect(clampDockWidth(100)).toBe(DOCK_WIDTH_MIN);
    expect(clampDockWidth(9000)).toBe(DOCK_WIDTH_MAX);
    expect(clampDockWidth(NaN)).toBe(DOCK_WIDTH_DEFAULT);
    expect(clampDockWidth(Infinity)).toBe(DOCK_WIDTH_DEFAULT);
  });
});

describe("computeDockRect", () => {
  it("left dock hugs the left edge, full height", () => {
    expect(computeDockRect(DISPLAY, "left", 400)).toEqual({
      x: 0, y: 0, width: 400, height: 1080,
    });
  });

  it("right dock hugs the right edge", () => {
    expect(computeDockRect(DISPLAY, "right", 400)).toEqual({
      x: 1520, y: 0, width: 400, height: 1080,
    });
  });

  it("respects a non-zero display origin (multi-monitor)", () => {
    expect(computeDockRect(LEFT_MONITOR, "left", 400)).toEqual({
      x: -2560, y: -200, width: 400, height: 1440,
    });
    expect(computeDockRect(LEFT_MONITOR, "right", 400)).toEqual({
      x: -400, y: -200, width: 400, height: 1440,
    });
  });

  it("supports the rail width", () => {
    expect(computeDockRect(DISPLAY, "left", RAIL_WIDTH).width).toBe(RAIL_WIDTH);
  });

  it("never exceeds the display width", () => {
    const r = computeDockRect({ ...DISPLAY, width: 300 }, "left", 9999);
    expect(r.width).toBe(300);
  });
});

describe("subtractDockStrip", () => {
  it("left strip leaves the right remainder", () => {
    const dock = computeDockRect(DISPLAY, "left", 400);
    expect(subtractDockStrip(DISPLAY, dock)).toEqual({
      x: 400, y: 0, width: 1520, height: 1080,
    });
  });

  it("right strip leaves the left remainder", () => {
    const dock = computeDockRect(DISPLAY, "right", 400);
    expect(subtractDockStrip(DISPLAY, dock)).toEqual({
      x: 0, y: 0, width: 1520, height: 1080,
    });
  });

  it("returns the full display when the strip is on another display", () => {
    const dock = computeDockRect(LEFT_MONITOR, "left", 400);
    expect(subtractDockStrip(DISPLAY, dock)).toEqual(DISPLAY);
  });

  it("handles negative-origin displays", () => {
    const dock = computeDockRect(LEFT_MONITOR, "left", 400);
    expect(subtractDockStrip(LEFT_MONITOR, dock)).toEqual({
      x: -2160, y: -200, width: 2160, height: 1440,
    });
  });

  it("never returns a zero-or-negative width", () => {
    const dock = { ...DISPLAY }; // strip covers the whole display
    const rest = subtractDockStrip(DISPLAY, dock);
    expect(rest.width).toBeGreaterThan(0);
  });
});
