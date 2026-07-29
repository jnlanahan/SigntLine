// The speech pipeline: one entry point, an ordered provider chain, and a
// cache in front of all of it.
//
// Order matters. ElevenLabs Flash is both the most human-sounding and the
// fastest, so it leads. Google Chirp 3 and OpenAI follow as progressively
// weaker but still-cloud fallbacks. The renderer's system voice is the last
// resort and is only reached when every provider here fails.
//
// Invariant: this module never throws for a recoverable reason. A missing key,
// a dead voice, a rate limit, or a hung request must degrade the voice, never
// stop the session.

import { logLine } from "../log";
import { loadSettings } from "../settings-store";
import { speakText, type TtsVoice } from "../openai-tts";
import { hasGoogleCredentials, speakTextGoogle } from "../google-tts";
import { speakTextElevenLabs, hasElevenLabsKey } from "./elevenlabs";
import { readCached, writeCached } from "./cache";
import {
  ELEVEN_MODEL,
  WARMABLE_PHRASES,
  preprocessForTts,
  type SynthRequest,
  type TtsProviderName,
} from "./shared";
import { getKey } from "../credentials";

export type SpokenEngine = Exclude<TtsProviderName, "system">;

export interface SpeakResult {
  audioBase64: string;
  engine: SpokenEngine;
  /** True when the audio came from disk — i.e. it started playing instantly. */
  cached: boolean;
  /** End-to-end milliseconds inside the main process. */
  ms: number;
}

export interface SpeakFailure {
  __error: "missing_tts_provider" | "request_failed";
  message: string;
}

// Per-provider hard timeouts. Each is generous enough for a slow-but-working
// request and short enough that falling through still beats silence.
const TIMEOUT_MS: Record<SpokenEngine, number> = {
  elevenlabs: 9_000,
  google: 10_000,
  openai: 15_000,
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function providerAvailable(name: SpokenEngine): Promise<boolean> {
  switch (name) {
    case "elevenlabs":
      return hasElevenLabsKey() || Boolean(await getKey("elevenlabs"));
    case "google":
      return hasGoogleCredentials();
    case "openai":
      return Boolean(await getKey("openai"));
  }
}

/**
 * Provider order for this call. An explicit setting pins the first provider
 * but never removes the fallbacks — a user who picked ElevenLabs and then let
 * their credits lapse should get a Google voice, not silence.
 */
function providerOrder(): SpokenEngine[] {
  const preferred = loadSettings().ttsProvider;
  const all: SpokenEngine[] = ["elevenlabs", "google", "openai"];
  if (preferred === "auto") return all;
  return [preferred, ...all.filter((p) => p !== preferred)];
}

function requestFor(text: string, provider: SpokenEngine): SynthRequest {
  const s = loadSettings();
  return {
    text,
    provider,
    voice: provider === "elevenlabs" ? s.elevenVoiceId : s.ttsVoice,
    model: provider === "elevenlabs" ? ELEVEN_MODEL : provider,
    speed: s.ttsSpeed,
  };
}

async function synthesize(
  text: string,
  provider: SpokenEngine,
): Promise<Buffer> {
  const s = loadSettings();
  switch (provider) {
    case "elevenlabs":
      return speakTextElevenLabs(text, {
        voiceId: s.elevenVoiceId,
        speed: s.ttsSpeed,
      });
    case "google":
      return speakTextGoogle(text, s.ttsVoice);
    case "openai":
      return speakText(text, { voice: s.ttsVoice as TtsVoice });
  }
}

/**
 * Speak one chunk of text. Returns base64 MP3 plus which engine produced it,
 * or an error envelope when every provider is unavailable or failing.
 */
export async function speak(text: string): Promise<SpeakResult | SpeakFailure> {
  const startedAt = Date.now();
  // Single preprocessing point for every path into synthesis — this is what
  // makes the startup warmer's cache keys match the live session's.
  const trimmed = preprocessForTts(text);
  if (!trimmed) {
    return { __error: "request_failed", message: "empty_text" };
  }

  const order = providerOrder();
  const failures: string[] = [];
  let anyAvailable = false;

  for (const provider of order) {
    if (!(await providerAvailable(provider))) continue;
    anyAvailable = true;

    const req = requestFor(trimmed, provider);
    const hit = readCached(req);
    if (hit) {
      return {
        audioBase64: hit.toString("base64"),
        engine: provider,
        cached: true,
        ms: Date.now() - startedAt,
      };
    }

    try {
      const audio = await withTimeout(
        synthesize(trimmed, provider),
        TIMEOUT_MS[provider],
        `${provider}_tts_timeout`,
      );
      writeCached(req, audio);
      const ms = Date.now() - startedAt;
      if (failures.length > 0) {
        logLine(`[tts] ${provider} succeeded after: ${failures.join(" | ")}`);
      }
      return {
        audioBase64: audio.toString("base64"),
        engine: provider,
        cached: false,
        ms,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${provider}: ${msg}`);
      logLine(`[tts] ${provider} failed (${msg}); trying next provider`);
    }
  }

  if (!anyAvailable) {
    return {
      __error: "missing_tts_provider",
      message:
        "No speech provider is configured. Add an ElevenLabs, Google, or OpenAI key.",
    };
  }
  return { __error: "request_failed", message: failures.join(" | ") };
}

/**
 * Pre-synthesize the fixed phrase set so the first filler of a session plays
 * instantly instead of paying full synthesis cost at the worst moment. Runs
 * once at startup, sequentially and unawaited — it must never delay launch or
 * burst the provider's rate limit.
 */
export async function warmPhraseCache(): Promise<void> {
  let active: SpokenEngine | null = null;
  for (const p of providerOrder()) {
    if (await providerAvailable(p)) {
      active = p;
      break;
    }
  }
  if (!active) return;

  let warmed = 0;
  let skipped = 0;
  for (const raw of WARMABLE_PHRASES) {
    // Same preprocessing as speak(), or the warmed key would never be hit.
    const phrase = preprocessForTts(raw);
    const req = requestFor(phrase, active);
    if (readCached(req)) {
      skipped++;
      continue;
    }
    try {
      const audio = await withTimeout(
        synthesize(phrase, active),
        TIMEOUT_MS[active],
        `${active}_warm_timeout`,
      );
      writeCached(req, audio);
      warmed++;
    } catch (err) {
      // One failure means the provider is unhappy — stop rather than hammer it.
      logLine(
        `[tts] phrase warm stopped after ${warmed}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }
  if (warmed > 0 || skipped > 0) {
    logLine(
      `[tts] phrase cache ready (${active}): ${warmed} synthesized, ${skipped} already cached`,
    );
  }
}
