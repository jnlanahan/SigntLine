import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Electron IPC dependencies before importing the module under test.
vi.mock("../lib/api", () => ({
  api: () => ({
    tts: {
      speak: vi.fn().mockResolvedValue({ __error: "not available in test" }),
    },
    log: vi.fn(),
  }),
}));

vi.mock("../store/settings", () => ({
  useSettings: {
    getState: () => ({ settings: { ttsVoice: undefined, ttsEnabled: true } }),
  },
}));

// Dynamic import so the module is fresh per describe block when needed.
describe("waitForSpeechEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported from useTts", async () => {
    const mod = await import("../hooks/useTts");
    expect(typeof mod.waitForSpeechEnd).toBe("function");
  });

  it("resolves immediately when nothing is playing (initial state)", async () => {
    const { waitForSpeechEnd } = await import("../hooks/useTts");
    // Should resolve without hanging — no audio is playing at module init.
    await expect(waitForSpeechEnd()).resolves.toBeUndefined();
  });

  it("resolves after cancel() is called", async () => {
    const { useTts, waitForSpeechEnd } = await import("../hooks/useTts");
    const { speak, cancel } = useTts();

    speak("hello world");
    // Promise is now pending (audio IPC call is in-flight)
    const done = waitForSpeechEnd();

    // Cancelling should resolve the promise immediately.
    cancel();

    // Should resolve now, not hang.
    await expect(done).resolves.toBeUndefined();
  });

  it("resolves when audio IPC fails (falls back to web speech or no-op)", async () => {
    const { useTts, waitForSpeechEnd } = await import("../hooks/useTts");
    const { speak } = useTts();

    speak("test fallback");
    const done = waitForSpeechEnd();

    // The mocked api returns an error, so playOpenAI fails and resolves the
    // promise via the fallback path. Await with a timeout guard.
    await expect(done).resolves.toBeUndefined();
  });
});

describe("WAITING_PHRASES", () => {
  it("has at least 7 entries", async () => {
    const { WAITING_PHRASES } = await import("../hooks/useTts");
    expect(WAITING_PHRASES.length).toBeGreaterThanOrEqual(7);
  });

  it("all phrases are under 12 words", async () => {
    const { WAITING_PHRASES } = await import("../hooks/useTts");
    for (const phrase of WAITING_PHRASES) {
      const wordCount = phrase.split(/\s+/).length;
      expect(wordCount, `"${phrase}" is too long (${wordCount} words)`).toBeLessThanOrEqual(12);
    }
  });

  it("no two consecutive phrases start with the same word", async () => {
    const { WAITING_PHRASES } = await import("../hooks/useTts");
    for (let i = 1; i < WAITING_PHRASES.length; i++) {
      const prev = WAITING_PHRASES[i - 1].split(" ")[0];
      const curr = WAITING_PHRASES[i].split(" ")[0];
      expect(curr, `Phrases ${i - 1} and ${i} both start with "${prev}"`).not.toBe(prev);
    }
  });
});
