import { describe, it, expect } from "vitest";

// Prompt sources: shared voice rules live in electron/agents/shared.ts, the
// tech support agent's skills in electron/agents/tech-support.ts. These
// guards lock the load-bearing phrases so a prompt edit that removes one is
// a deliberate decision.

async function sharedSrc(): Promise<string> {
  const src = await import("../../electron/agents/shared?raw");
  return (src as unknown as { default: string }).default;
}

async function techSupportSrc(): Promise<string> {
  const src = await import("../../electron/agents/tech-support?raw");
  return (src as unknown as { default: string }).default;
}

describe("shared VOICE_RULES", () => {
  it("contains 'One action per response'", async () => {
    expect(await sharedSrc()).toContain("One action per response");
  });

  it("contains 'end on a natural landing point'", async () => {
    expect(await sharedSrc()).toContain("natural landing point");
  });

  it("keeps responses short (60-word cap)", async () => {
    expect(await sharedSrc()).toContain("never more than 60 words");
  });

  it("asks for one idea per sentence (chunked-TTS friendly)", async () => {
    expect(await sharedSrc()).toContain("One idea per sentence");
  });
});

describe("tech support agent — pacing", () => {
  it("contains pacing instruction", async () => {
    const content = await techSupportSrc();
    expect(
      content.includes("one concrete step") || content.includes("Pace yourself")
    ).toBe(true);
  });
});

describe("tech support agent — never-dead-air rules", () => {
  it("first turn forces a spoken first step", async () => {
    const content = await techSupportSrc();
    expect(content).toContain("The session just started");
    expect(content).toContain("Do not choose wait");
    expect(content).toContain("do not set digression=true");
  });

  it("stall check-in mentions the wrong-monitor possibility", async () => {
    expect(await techSupportSrc()).toContain("which screen or monitor");
  });

  it("stall guidance checks for completed steps before waiting", async () => {
    expect(await techSupportSrc()).toContain(
      "if the user already completed that step, give the NEXT step now"
    );
  });
});
