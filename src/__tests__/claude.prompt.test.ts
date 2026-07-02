import { describe, it, expect } from "vitest";

describe("Claude system prompt — VOICE_RULES", () => {
  it("contains 'One action per response'", async () => {
    const src = await import("../../electron/claude?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "One action per response"
    );
  });

  it("contains 'end on a natural landing point'", async () => {
    const src = await import("../../electron/claude?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "natural landing point"
    );
  });
});

describe("Claude system prompt — TECH_SUPPORT_INTRO", () => {
  it("contains pacing instruction", async () => {
    const src = await import("../../electron/claude?raw");
    const content = (src as unknown as { default: string }).default;
    // One-step-at-a-time pacing must be stated somewhere in the prompt.
    expect(
      content.includes("one concrete step") || content.includes("Pace yourself")
    ).toBe(true);
  });
});

describe("Claude context header — never-dead-air rules", () => {
  it("first turn forces a spoken first step", async () => {
    const src = await import("../../electron/claude?raw");
    const content = (src as unknown as { default: string }).default;
    expect(content).toContain("The session just started");
    expect(content).toContain("Do not choose wait");
    expect(content).toContain("do not set digression=true");
  });

  it("stall check-in mentions the wrong-monitor possibility", async () => {
    const src = await import("../../electron/claude?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "which screen or monitor"
    );
  });
});

describe("Claude system prompt — spoken-style rules", () => {
  it("keeps responses short (60-word cap)", async () => {
    const src = await import("../../electron/claude?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "never more than 60 words"
    );
  });

  it("asks for one idea per sentence (chunked-TTS friendly)", async () => {
    const src = await import("../../electron/claude?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "One idea per sentence"
    );
  });
});
