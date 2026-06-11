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
    // Either "one instruction" or "Pace yourself" must appear
    expect(
      content.includes("one instruction") || content.includes("Pace yourself")
    ).toBe(true);
  });
});
