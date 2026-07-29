// Pure helpers shared by the TTS providers. No Electron, no network, no fs —
// so the renderer test suite can import this directly.

export type TtsProviderName = "elevenlabs" | "google" | "openai" | "system";

/** One synthesis request, fully described. Doubles as the cache key input. */
export interface SynthRequest {
  text: string;
  provider: TtsProviderName;
  voice: string;
  model: string;
  speed: number;
}

/**
 * Stable cache key for a synthesis request. Any field that changes the audio
 * must be part of the key, or the cache would serve the wrong voice after a
 * settings change.
 */
export function cacheKeyFor(req: SynthRequest): string {
  // JSON encoding gives an unambiguous joining of the fields for free: no
  // separator character can be confused with field content, so ("ab","c") and
  // ("a","bc") can never produce the same key.
  const canonical = JSON.stringify([
    req.provider,
    req.voice,
    req.model,
    req.speed.toFixed(2),
    normalizeForKey(req.text),
  ]);
  return fnv1a64(canonical);
}

// Text that differs only in surrounding or repeated whitespace produces
// identical audio, so folding it multiplies cache hits on the fixed phrase
// set (fillers, acknowledgements, completions).
function normalizeForKey(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// 64-bit FNV-1a-style hash as two 32-bit halves — no crypto import,
// deterministic, and far more than enough collision resistance for a local
// audio cache.
function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c << 3) | (c >>> 5);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Light rewrites that make synthesized speech land better. Applied in exactly
 * one place — every path into the TTS pipeline runs text through this — so the
 * startup cache warmer and the live session produce byte-identical strings and
 * therefore identical cache keys. Idempotent: running it twice is a no-op.
 */
export function preprocessForTts(text: string): string {
  return text
    .replace(/^(Okay|Alright|Cool|Nice|Right|Great|Got it|Perfect)(\s+)/i, "$1,$2")
    .replace(/ — /g, ", ")
    .replace(/\.{3}$/, ".")
    .trim();
}

// ── The coach's fixed phrase set ──
// These are spoken verbatim, over and over. Defined here rather than in the
// renderer so the startup cache warmer can reach them without IPC; the
// renderer re-exports them from src/hooks/useTts.ts.

/** Spoken when the user has been idle a while with no screen change. */
export const WAITING_PHRASES: readonly string[] = [
  "No rush — take your time.",
  "Still here whenever you're ready.",
  "Go ahead and give that a try.",
  "Take a sec, I'm not going anywhere.",
  "Whenever you're ready, I'll pick it up.",
  "Feel free to ask if anything's unclear.",
  "I'm watching — take as long as you need.",
  "No rush — just ask if you get stuck.",
];

/** Spoken on goal completion. */
export const COMPLETION_PHRASES: readonly string[] = [
  "And that's a wrap. Nice work.",
  "Done. Not bad at all.",
  "Nailed it — you're all set.",
  "That's the whole thing. Well played.",
  "Goal achieved. See? Wasn't so bad.",
];

/**
 * Spoken the instant the user asks a question, while the vision call runs.
 * Conversational fillers measurably improve perceived responsiveness for waits
 * over ~3 s — exactly the length of a vision call. These are the highest-value
 * entries in the cache: they play at 0 ms on the turn the user is waiting.
 */
export const THINKING_PHRASES: readonly string[] = [
  "Let me take a look.",
  "Hmm, let me see.",
  "Good question — one sec.",
  "Let me check that.",
  "Okay, looking now.",
];

/**
 * Everything worth pre-synthesizing at startup, so the first filler of a
 * session plays instantly instead of paying full synthesis cost at the worst
 * possible moment.
 */
export const WARMABLE_PHRASES: readonly string[] = [
  ...THINKING_PHRASES,
  ...COMPLETION_PHRASES,
  ...WAITING_PHRASES,
];

/**
 * ElevenLabs premade voices that suit a calm, competent coach. The Settings
 * picker lists whatever the account actually has (fetched live); this is the
 * offline default set and the source of the shipped default.
 */
export interface VoicePreset {
  id: string;
  name: string;
  blurb: string;
}

export const ELEVEN_VOICE_PRESETS: readonly VoicePreset[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", blurb: "Warm, even, unhurried" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", blurb: "Soft and clear" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", blurb: "Relaxed, friendly" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", blurb: "Warm British male" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", blurb: "Deep, steady male" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", blurb: "Calm British male" },
];

export const DEFAULT_ELEVEN_VOICE_ID = ELEVEN_VOICE_PRESETS[0].id;

// Flash v2.5 is the low-latency model (~75 ms model time-to-first-byte). The
// coach speaks in short sentences, which is exactly its sweet spot.
export const ELEVEN_MODEL = "eleven_flash_v2_5";

/**
 * 64 kbps 44.1 kHz MP3: audibly clean for speech and roughly half the bytes
 * of the 128 kbps default, so it finishes generating and transferring sooner.
 */
export const ELEVEN_OUTPUT_FORMAT = "mp3_44100_64";

/**
 * Long text defeats the point of sentence-level streaming and risks the
 * provider's per-request character limit. The chunker keeps us far below
 * this; the clamp is a guard against a pathological response.
 */
export const MAX_TTS_CHARS = 900;

export function clampTtsText(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_TTS_CHARS) return t;
  // Cut at the last sentence end that fits, else hard-cut on a word boundary.
  const head = t.slice(0, MAX_TTS_CHARS);
  const lastStop = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (lastStop > MAX_TTS_CHARS * 0.5) return head.slice(0, lastStop + 1);
  const lastSpace = head.lastIndexOf(" ");
  return lastSpace > 0 ? head.slice(0, lastSpace) : head;
}
