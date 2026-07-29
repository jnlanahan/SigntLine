import { describe, expect, it } from "vitest";
import {
  HoldDetector,
  isPushToTalkCode,
  pushToTalkCodes,
  pushToTalkLabel,
} from "../../electron/hotkey";
import type { PushToTalkKey } from "../../electron/types";

const ALL_KEYS: PushToTalkKey[] = ["ctrl", "alt", "f8", "f9", "none"];

describe("push-to-talk key mapping", () => {
  it("maps modifiers to both the left and right physical keys", () => {
    expect(pushToTalkCodes("ctrl")).toHaveLength(2);
    expect(pushToTalkCodes("alt")).toHaveLength(2);
  });

  it("maps function keys to exactly one code", () => {
    expect(pushToTalkCodes("f8")).toEqual([66]);
    expect(pushToTalkCodes("f9")).toEqual([67]);
  });

  it('matches nothing when push-to-talk is "none"', () => {
    expect(pushToTalkCodes("none")).toEqual([]);
    expect(isPushToTalkCode("none", 67)).toBe(false);
    expect(isPushToTalkCode("none", 29)).toBe(false);
  });

  it("never claims a key belonging to a different binding", () => {
    expect(isPushToTalkCode("f9", 66)).toBe(false);
    expect(isPushToTalkCode("f8", 67)).toBe(false);
    expect(isPushToTalkCode("ctrl", 56)).toBe(false);
  });

  it("has a label for every binding", () => {
    for (const key of ALL_KEYS) {
      expect(pushToTalkLabel(key).length).toBeGreaterThan(0);
    }
  });
});

describe("HoldDetector", () => {
  it("reports one press edge and one release edge", () => {
    const d = new HoldDetector();
    expect(d.keyDown(true)).toBe("press");
    expect(d.keyUp(true)).toBe("release");
  });

  it("collapses OS auto-repeat into a single press", () => {
    const d = new HoldDetector();
    expect(d.keyDown(true)).toBe("press");
    // The OS re-fires keydown many times per second while the key is held.
    for (let i = 0; i < 20; i++) expect(d.keyDown(true)).toBeNull();
    expect(d.keyUp(true)).toBe("release");
  });

  it("ignores keys that are not the bound one", () => {
    const d = new HoldDetector();
    expect(d.keyDown(false)).toBeNull();
    expect(d.keyUp(false)).toBeNull();
    expect(d.isDown()).toBe(false);
  });

  it("ignores a release that was never preceded by a press", () => {
    // Happens when the app starts while the key is already held down.
    const d = new HoldDetector();
    expect(d.keyUp(true)).toBeNull();
  });

  it("tracks whether the key is currently held", () => {
    const d = new HoldDetector();
    expect(d.isDown()).toBe(false);
    d.keyDown(true);
    expect(d.isDown()).toBe(true);
    d.keyUp(true);
    expect(d.isDown()).toBe(false);
  });

  it("reset() unlatches a held key so rebinding cannot leave the mic open", () => {
    const d = new HoldDetector();
    d.keyDown(true);
    expect(d.isDown()).toBe(true);
    d.reset();
    expect(d.isDown()).toBe(false);
    // And the next press is a real press again, not swallowed as auto-repeat.
    expect(d.keyDown(true)).toBe("press");
  });

  it("survives interleaved presses of other keys", () => {
    const d = new HoldDetector();
    expect(d.keyDown(true)).toBe("press");
    expect(d.keyDown(false)).toBeNull();
    expect(d.keyUp(false)).toBeNull();
    expect(d.isDown()).toBe(true);
    expect(d.keyUp(true)).toBe("release");
  });
});
