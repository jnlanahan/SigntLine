// Regression guards for timing constants.
// These lock in the agreed values so any future change is intentional.
import { describe, it, expect } from "vitest";

// We test the exported values indirectly by importing the constants.
// Since the constants are not exported, we check them via the module source.
// The real guard is: if someone changes a value, this test breaks and forces
// a deliberate decision.

describe("timing constants (regression guards)", () => {
  it("TS_POST_INSTRUCTION_COOLDOWN_MS is 5000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_POST_INSTRUCTION_COOLDOWN_MS = 5000"
    );
  });

  it("TS_QUIET_PERIOD_MS is 3500", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_QUIET_PERIOD_MS = 3_500"
    );
  });

  it("TS_WAITING_NUDGE_DELAY_MS is 30000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_WAITING_NUDGE_DELAY_MS = 30_000"
    );
  });

  it("TS_NUDGE_REPEAT_INTERVAL_MS is 60000", async () => {
    const src = await import("../hooks/useSessionLoop?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "TS_NUDGE_REPEAT_INTERVAL_MS = 60_000"
    );
  });

  it("alert window constants are gone (Step 3.3 cleanup)", async () => {
    const src = (await import("../hooks/useSessionLoop?raw")) as unknown as { default: string };
    expect(src.default).not.toContain("TS_ALERT_WINDOW_MS");
    expect(src.default).not.toContain("TS_ALERT_INTERVAL_MS");
    expect(src.default).not.toContain("afterInstructionAlertUntil");
  });
});
