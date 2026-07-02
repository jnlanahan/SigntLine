import { describe, it, expect } from "vitest";
import {
  markerRatio,
  pickMarkerSource,
  MIN_MARKER_RATIO,
  type BitmapLike,
} from "../../electron/calibrate-detect";

// Build a BGRA buffer filled with one color, optionally splitting the top
// portion with a second color.
function bitmap(
  width: number,
  height: number,
  bgra: [number, number, number, number],
  topFraction = 1,
  topBgra?: [number, number, number, number],
): BitmapLike {
  const data = new Uint8Array(width * height * 4);
  const splitRow = Math.floor(height * topFraction);
  for (let y = 0; y < height; y++) {
    const px = y < splitRow && topBgra ? topBgra : bgra;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = px[3];
    }
  }
  return { data, width, height };
}

const MAGENTA: [number, number, number, number] = [255, 0, 255, 255]; // BGRA
// Night Light shifts everything warm: blue drops, green rises a little.
const NIGHT_LIGHT_MAGENTA: [number, number, number, number] = [140, 60, 255, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const GREEN: [number, number, number, number] = [40, 200, 40, 255];
const DESKTOP_GRAY: [number, number, number, number] = [60, 58, 55, 255];

describe("markerRatio", () => {
  it("full magenta screen reads ~1", () => {
    expect(markerRatio(bitmap(320, 200, MAGENTA))).toBeGreaterThan(0.98);
  });

  it("night-light-shifted magenta still counts", () => {
    expect(markerRatio(bitmap(320, 200, NIGHT_LIGHT_MAGENTA))).toBeGreaterThan(0.98);
  });

  it("white screen reads ~0 (G too high)", () => {
    expect(markerRatio(bitmap(320, 200, WHITE))).toBe(0);
  });

  it("green screen reads ~0", () => {
    expect(markerRatio(bitmap(320, 200, GREEN))).toBe(0);
  });

  it("desktop gray reads ~0", () => {
    expect(markerRatio(bitmap(320, 200, DESKTOP_GRAY))).toBe(0);
  });

  it("half-magenta screen reads ~0.5", () => {
    const r = markerRatio(bitmap(320, 200, DESKTOP_GRAY, 0.5, MAGENTA));
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.6);
  });

  it("empty bitmap reads 0", () => {
    expect(markerRatio({ data: new Uint8Array(0), width: 0, height: 0 })).toBe(0);
  });
});

describe("pickMarkerSource", () => {
  it("returns null for no candidates", () => {
    expect(pickMarkerSource([])).toBeNull();
  });

  it("confident when marker screen dominates a quiet runner-up", () => {
    const pick = pickMarkerSource([
      { id: "screen:1:0", ratio: 0.97 },
      { id: "screen:2:0", ratio: 0.01 },
    ]);
    expect(pick?.id).toBe("screen:1:0");
    expect(pick?.confident).toBe(true);
  });

  it("not confident below the minimum floor", () => {
    const pick = pickMarkerSource([
      { id: "a", ratio: MIN_MARKER_RATIO - 0.05 },
      { id: "b", ratio: 0.0 },
    ]);
    expect(pick?.confident).toBe(false);
  });

  it("not confident when the runner-up is close (mirrored displays)", () => {
    const pick = pickMarkerSource([
      { id: "a", ratio: 0.9 },
      { id: "b", ratio: 0.85 },
    ]);
    expect(pick?.confident).toBe(false);
  });

  it("confident with 3x dominance even when runner-up is above the noise floor", () => {
    const pick = pickMarkerSource([
      { id: "a", ratio: 0.9 },
      { id: "b", ratio: 0.2 },
    ]);
    expect(pick?.confident).toBe(true);
  });

  it("single source is confident when above floor", () => {
    const pick = pickMarkerSource([{ id: "only", ratio: 0.95 }]);
    expect(pick?.confident).toBe(true);
  });
});
