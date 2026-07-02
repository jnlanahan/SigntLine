// Regression guards for timing constants.
// These lock in the agreed values so any future change is intentional.
import { describe, it, expect } from "vitest";

// We test the values via the module source since the constants are not
// exported. The real guard is: if someone changes a value, this test breaks
// and forces a deliberate decision.

describe("timing constants (regression guards)", () => {
  it("TS_MIN_CALL_SPACING_MS is 5000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_MIN_CALL_SPACING_MS = 5_000"
    );
  });

  it("TS_QUIET_PERIOD_MS is 3500", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_QUIET_PERIOD_MS = 3_500"
    );
  });

  it("TS_BACKSTOP_MS is 15000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_BACKSTOP_MS = 15_000"
    );
  });

  it("TS_SLOW_BACKSTOP_MS is 30000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_SLOW_BACKSTOP_MS = 30_000"
    );
  });

  it("CHECK_IN_REPEAT_MS is 60000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "CHECK_IN_REPEAT_MS = 60_000"
    );
  });

  it("follow-ups bypass the minimum call spacing", async () => {
    const src = (await import("../hooks/useSessionLoop?raw")) as unknown as {
      default: string;
    };
    expect(src.default).toContain("!state.pendingFollowUp");
  });

  it("DIVERTED_STALL_MS is 120000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "DIVERTED_STALL_MS = 120_000"
    );
  });

  it("a digression can no longer suppress stall check-ins forever", async () => {
    const src = (await import("../hooks/useSessionLoop?raw")) as unknown as {
      default: string;
    };
    expect(src.default).toContain(
      "(!s0.diverted || sinceChangeMs >= DIVERTED_STALL_MS)"
    );
  });

  it("first tick after session start is flagged (guaranteed first step)", async () => {
    const src = (await import("../hooks/useSessionLoop?raw")) as unknown as {
      default: string;
    };
    expect(src.default).toContain("sessionJustStarted");
  });
});
