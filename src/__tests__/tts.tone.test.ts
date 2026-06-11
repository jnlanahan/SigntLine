import { describe, it, expect } from "vitest";

describe("OpenAI TTS tone instructions", () => {
  it("contains 'patient'", async () => {
    const src = await import("../../electron/openai-tts?raw");
    expect((src as unknown as { default: string }).default).toContain("patient");
  });

  it("contains 'unhurried'", async () => {
    const src = await import("../../electron/openai-tts?raw");
    expect((src as unknown as { default: string }).default).toContain("unhurried");
  });

  it("does not contain 'energy' (prevents rushed delivery)", async () => {
    const src = await import("../../electron/openai-tts?raw");
    expect((src as unknown as { default: string }).default).not.toContain(
      '"energy"'
    );
  });
});

describe("Google TTS speaking rate", () => {
  it("speakingRate is 1.0 (not faster)", async () => {
    const src = await import("../../electron/google-tts?raw");
    expect((src as unknown as { default: string }).default).toContain(
      "speakingRate: 1.0"
    );
  });
});
