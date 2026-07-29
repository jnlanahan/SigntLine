// ElevenLabs Flash v2.5 — the low-latency voice. Roughly 4x faster to first
// audio than the Google Chirp 3 path it replaces, and the reason the coach
// stops sounding like a screen reader.
//
// Everything here is best-effort: if the key is missing, the account lacks
// the model, or the network is down, the caller falls through to Google →
// OpenAI → the system voice. Voice must never be a hard dependency.

import { getKey } from "../credentials";
import {
  ELEVEN_MODEL,
  ELEVEN_OUTPUT_FORMAT,
  ELEVEN_VOICE_PRESETS,
  DEFAULT_ELEVEN_VOICE_ID,
  clampTtsText,
} from "./shared";

const API_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenVoice {
  id: string;
  name: string;
  blurb: string;
}

export function hasElevenLabsKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

async function apiKey(): Promise<string | null> {
  const stored = await getKey("elevenlabs");
  if (stored) return stored;
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

// Voice ids that came back 404/422 — a stale preset id or a voice removed
// from the account. Remembered so we stop retrying it every sentence and fall
// back to the account's own first voice instead.
const deadVoices = new Set<string>();
let resolvedFallbackVoice: string | null = null;

/**
 * Synthesize one chunk. `speed` maps onto ElevenLabs' voice_settings.speed
 * (0.7–1.2); values outside that range are clamped rather than rejected.
 */
export async function speakTextElevenLabs(
  text: string,
  opts: { voiceId?: string; speed?: number; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const key = await apiKey();
  if (!key) throw new Error("missing_elevenlabs_key");

  let voiceId = opts.voiceId?.trim() || DEFAULT_ELEVEN_VOICE_ID;
  if (deadVoices.has(voiceId)) {
    voiceId = (await accountFallbackVoice(key)) ?? DEFAULT_ELEVEN_VOICE_ID;
  }

  const body = {
    text: clampTtsText(text),
    model_id: ELEVEN_MODEL,
    voice_settings: {
      // Tuned for a coach, not an audiobook narrator. Moderate stability keeps
      // the delivery even without flattening it; a little style adds the
      // conversational lilt that makes it read as a person.
      stability: 0.45,
      similarity_boost: 0.75,
      style: 0.35,
      use_speaker_boost: true,
      speed: clampSpeed(opts.speed),
    },
  };

  const resp = await fetch(
    `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
      `?output_format=${ELEVEN_OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
  );

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    // A voice this account can't use is recoverable — remember it and let the
    // next call fall back to one the account actually has.
    //   404/422 — the id doesn't exist
    //   402     — a Voice Library voice on a plan that doesn't include them
    //   401     — an instantly-cloned voice on a plan that doesn't include them
    // The last two are the common ones on free accounts, and without them a
    // single unusable default voice silently downgrades the whole session to
    // the system voice instead of just picking a different ElevenLabs voice.
    if ([401, 402, 404, 422].includes(resp.status)) deadVoices.add(voiceId);
    throw new Error(
      `elevenlabs_http_${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length === 0) throw new Error("elevenlabs_empty_audio");
  return buf;
}

function clampSpeed(speed: number | undefined): number {
  if (typeof speed !== "number" || !Number.isFinite(speed)) return 1.0;
  return Math.max(0.7, Math.min(1.2, speed));
}

/**
 * Voices available on this account, for the Settings picker. Falls back to the
 * curated preset list when the call fails so the UI is never empty.
 */
export async function listElevenVoices(): Promise<ElevenVoice[]> {
  const key = await apiKey();
  if (!key) return [...ELEVEN_VOICE_PRESETS];
  try {
    const resp = await fetch(`${API_BASE}/voices`, {
      headers: { "xi-api-key": key },
    });
    if (!resp.ok) return [...ELEVEN_VOICE_PRESETS];
    const data = (await resp.json()) as {
      voices?: Array<{
        voice_id?: string;
        name?: string;
        labels?: Record<string, string>;
        category?: string;
      }>;
    };
    const voices = (data.voices ?? [])
      .filter((v) => v.voice_id && v.name)
      .map((v) => ({
        id: String(v.voice_id),
        name: String(v.name),
        blurb: describeLabels(v.labels) || String(v.category ?? ""),
      }));
    return voices.length > 0 ? voices : [...ELEVEN_VOICE_PRESETS];
  } catch {
    return [...ELEVEN_VOICE_PRESETS];
  }
}

function describeLabels(labels: Record<string, string> | undefined): string {
  if (!labels) return "";
  return [labels.accent, labels.description, labels.age]
    .filter(Boolean)
    .join(", ");
}

// First voice the account actually owns — used when the configured id is dead.
async function accountFallbackVoice(key: string): Promise<string | null> {
  if (resolvedFallbackVoice) return resolvedFallbackVoice;
  try {
    const resp = await fetch(`${API_BASE}/voices`, {
      headers: { "xi-api-key": key },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      voices?: Array<{ voice_id?: string; category?: string }>;
    };
    const usable = (data.voices ?? []).filter(
      (v) => v.voice_id && !deadVoices.has(v.voice_id),
    );
    // Prefer a premade voice: those work on every plan. Cloned and library
    // voices are plan-gated, so picking one as the fallback can fail for the
    // exact same reason the original voice did.
    const first =
      usable.find((v) => v.category === "premade") ?? usable[0];
    resolvedFallbackVoice = first?.voice_id ?? null;
    return resolvedFallbackVoice;
  } catch {
    return null;
  }
}
