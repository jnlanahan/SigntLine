import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQuietPeriodTimer } from "../hooks/useQuietPeriod";

describe("createQuietPeriodTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("callback fires after delayMs with no further activity", () => {
    const cb = vi.fn();
    const { onActivity } = createQuietPeriodTimer(3500, cb);
    onActivity();
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("callback does NOT fire if onActivity is called within delayMs", () => {
    const cb = vi.fn();
    const { onActivity } = createQuietPeriodTimer(3500, cb);
    onActivity();
    vi.advanceTimersByTime(2000);
    onActivity(); // reset — 2s elapsed, restart from zero
    vi.advanceTimersByTime(2000); // only 2s since reset, 4s total
    expect(cb).not.toHaveBeenCalled();
  });

  it("onActivity resets the countdown timer", () => {
    const cb = vi.fn();
    const { onActivity } = createQuietPeriodTimer(3500, cb);
    onActivity();
    vi.advanceTimersByTime(3000); // 3s — not yet fired
    onActivity(); // reset
    vi.advanceTimersByTime(1000); // only 1s since reset — should not fire
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500); // now 3.5s since last reset — fires
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("rapid activity fires callback exactly once after final pause", () => {
    const cb = vi.fn();
    const { onActivity } = createQuietPeriodTimer(3500, cb);
    for (let i = 0; i < 10; i++) {
      onActivity();
      vi.advanceTimersByTime(100); // 100ms between each call
    }
    // 1s elapsed total — now advance past the full delay since last call
    vi.advanceTimersByTime(3500);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cleanup cancels the pending timer", () => {
    const cb = vi.fn();
    const { onActivity, cleanup } = createQuietPeriodTimer(3500, cb);
    onActivity();
    cleanup();
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cleanup is safe to call when no timer is pending", () => {
    const { cleanup } = createQuietPeriodTimer(3500, vi.fn());
    expect(() => cleanup()).not.toThrow();
  });

  it("callback is not called before any activity", () => {
    const cb = vi.fn();
    createQuietPeriodTimer(3500, cb);
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
  });
});
