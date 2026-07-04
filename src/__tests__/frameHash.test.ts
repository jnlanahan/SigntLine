import { describe, it, expect } from "vitest";
import { hashDistance, hashesAreSimilar } from "../lib/frameHash";

// Build a 256-cell signature (16x16 grid) from a base luminance, with
// specific cells overridden.
function sig(base: number, overrides: Record<number, number> = {}): string {
  let out = "";
  for (let i = 0; i < 256; i++) {
    const v = overrides[i] ?? base;
    out += Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  }
  return out;
}

describe("frameHash comparator", () => {
  it("identical signatures are similar (distance 0)", () => {
    const a = sig(128);
    expect(hashDistance(a, a)).toBe(0);
    expect(hashesAreSimilar(a, a)).toBe(true);
  });

  it("tiny luminance wobble (compression noise) does not count as change", () => {
    const a = sig(128);
    const b = sig(133); // +5 everywhere — under the per-cell delta
    expect(hashDistance(a, b)).toBe(0);
    expect(hashesAreSimilar(a, b)).toBe(true);
  });

  it("a cursor-sized change (1-2 cells) is still 'similar'", () => {
    const a = sig(128);
    const b = sig(128, { 40: 180, 41: 90 });
    expect(hashDistance(a, b)).toBe(2);
    expect(hashesAreSimilar(a, b)).toBe(true);
  });

  it("a small UI change (3+ cells) IS a screen change", () => {
    // A clicked tab / small panel: 3 cells shift meaningfully.
    const a = sig(128);
    const b = sig(128, { 10: 170, 11: 170, 26: 60 });
    expect(hashDistance(a, b)).toBe(3);
    expect(hashesAreSimilar(a, b)).toBe(false);
  });

  it("a dialog or new panel changes many cells", () => {
    const overrides: Record<number, number> = {};
    for (let i = 100; i < 130; i++) overrides[i] = 240;
    const a = sig(128);
    const b = sig(128, overrides);
    expect(hashDistance(a, b)).toBe(30);
    expect(hashesAreSimilar(a, b)).toBe(false);
  });

  it("missing or incomparable signatures are never similar", () => {
    const a = sig(128);
    expect(hashesAreSimilar(a, "")).toBe(false);
    expect(hashesAreSimilar("", a)).toBe(false);
    // Old-format 64-bit hash (16 chars) vs new signature — incomparable.
    expect(hashesAreSimilar(a, "0123456789abcdef")).toBe(false);
    expect(hashDistance(a, "0123456789abcdef")).toBe(Number.POSITIVE_INFINITY);
  });
});
