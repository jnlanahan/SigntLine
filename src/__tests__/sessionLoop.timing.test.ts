// Regression guards for timing constants.
// These lock in the agreed values so any future change is intentional.
import { describe, it, expect } from "vitest";

// We test the values via the module source since the constants are not
// exported. The real guard is: if someone changes a value, this test breaks
// and forces a deliberate decision.

async function loopSource(): Promise<string> {
  const src = await import("../hooks/useSessionLoop?raw");
  return (src as unknown as { default: string }).default;
}

describe("timing constants (regression guards)", () => {
  // Lowered from 5_000 (July 2026) together with the quiet period. The loop
  // looking more often does not make the coach talk more often — "wait" is
  // the model's most common action — so this buys reaction speed, not
  // interruptions. Cost is bounded by the session budget guardrails instead.
  it("TS_MIN_CALL_SPACING_MS is 3000", async () => {
    expect(await loopSource()).toContain("TS_MIN_CALL_SPACING_MS = 3_000");
  });

  // Lowered from 3_500 (July 2026). This is the dominant term in perceived
  // latency after the user clicks something, and the single biggest win
  // available on "why is it so slow to react".
  it("TS_QUIET_PERIOD_MS is 1500", async () => {
    expect(await loopSource()).toContain("TS_QUIET_PERIOD_MS = 1_500");
  });

  it("TS_BACKSTOP_MS is 15000", async () => {
    expect(await loopSource()).toContain("TS_BACKSTOP_MS = 15_000");
  });

  it("TS_SLOW_BACKSTOP_MS is 30000", async () => {
    expect(await loopSource()).toContain("TS_SLOW_BACKSTOP_MS = 30_000");
  });

  it("CHECK_IN_REPEAT_MS is 60000", async () => {
    expect(await loopSource()).toContain("CHECK_IN_REPEAT_MS = 60_000");
  });

  it("follow-ups bypass the minimum call spacing", async () => {
    expect(await loopSource()).toContain("!state.pendingFollowUp");
  });

  it("DIVERTED_STALL_MS is 120000", async () => {
    expect(await loopSource()).toContain("DIVERTED_STALL_MS = 120_000");
  });

  it("a digression can no longer suppress stall check-ins forever", async () => {
    expect(await loopSource()).toContain(
      "(!s0.diverted || sinceChangeMs >= DIVERTED_STALL_MS)",
    );
  });

  it("first tick after session start is flagged (guaranteed first step)", async () => {
    expect(await loopSource()).toContain("sessionJustStarted");
  });

  // The quiet period is only safe to shorten because speech is gated
  // separately. If either guard is removed, a fast tick would cut the coach
  // off mid-sentence — the exact bug that made the app feel like it was
  // talking over the user.
  it("a quiet-period tick never fires while the coach is speaking", async () => {
    const src = await loopSource();
    expect(src).toContain("if (isSpeaking()) return;");
  });

  it("the backstop chain waits for speech to finish before ticking", async () => {
    expect(await loopSource()).toContain("await waitForSpeechEnd();");
  });
});

describe("the coach never talks over itself or ignores the user", () => {
  // Repeats have to be caught in the chunk handler. The post-response dedupe
  // still exists as a backstop, but by the time it runs every sentence has
  // already been enqueued for playback — suppressing there is too late to
  // stop the user hearing it.
  it("repeat suppression runs on streamed chunks, not just the final result", async () => {
    const src = await loopSource();
    expect(src).toContain("isRepeatedSentence(chunk.text, previousInstruction)");
  });

  it("withheld chunks are not re-spoken by the end-of-response fallback", async () => {
    const src = await loopSource();
    expect(src).toContain("if (!earlySpoken && !suppressedRepeat)");
  });

  // A follow-up is an explicit question. Neither anti-repetition guard may
  // apply to it: saying an answer again because the user asked is correct,
  // and a silent turn leaves them hanging after the filler already played.
  it("a follow-up turn is exempt from repeat suppression", async () => {
    const src = await loopSource();
    expect(src).toContain("const answeringFollowUp = Boolean(followUp);");
    expect(src).toContain("!answeringFollowUp &&");
  });

  it("a follow-up that returns wait is recovered into something spoken", async () => {
    const src = await loopSource();
    expect(src).toContain('if (answeringFollowUp && action === "wait")');
    expect(src).toContain("randomNoAnswerPhrase()");
  });
});

describe("vision payload size (regression guards)", () => {
  // Each attached frame is ~1.2k tokens of prefill and lands directly on
  // time-to-first-token. Reduced from 3 to 2 in July 2026; raising it again
  // is a deliberate latency-for-context trade.
  it("MAX_FRAMES is 2", async () => {
    const src = await import("../../electron/claude?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "const MAX_FRAMES = 2",
    );
  });
});
