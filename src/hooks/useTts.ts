import { api } from "../lib/api";
import { useSession } from "../store/session";
import {
  preprocessForTts,
  COMPLETION_PHRASES,
  NO_ANSWER_PHRASES,
  THINKING_PHRASES,
  WAITING_PHRASES,
} from "../../electron/tts/shared";

// The fixed phrase set lives in electron/tts/shared.ts so the main process can
// pre-synthesize it at startup without an IPC round-trip. Re-exported here
// because this is where the rest of the renderer expects to find it — one
// definition, so a phrase can never drift out of the warm cache.
export {
  COMPLETION_PHRASES,
  NO_ANSWER_PHRASES,
  THINKING_PHRASES,
  WAITING_PHRASES,
};

function pickRandom<T>(arr: readonly T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  let next = arr[Math.floor(Math.random() * arr.length)];
  if (avoid !== undefined && next === avoid) {
    next = arr[(arr.indexOf(next) + 1) % arr.length];
  }
  return next;
}

let lastWaitingPhrase: string | undefined;
let lastCompletionPhrase: string | undefined;
let lastThinkingPhrase: string | undefined;
let lastNoAnswerPhrase: string | undefined;

export function randomWaitingPhrase(): string {
  lastWaitingPhrase = pickRandom(WAITING_PHRASES, lastWaitingPhrase);
  return lastWaitingPhrase;
}

export function randomCompletionPhrase(): string {
  lastCompletionPhrase = pickRandom(COMPLETION_PHRASES, lastCompletionPhrase);
  return lastCompletionPhrase;
}

export function randomThinkingPhrase(): string {
  lastThinkingPhrase = pickRandom(THINKING_PHRASES, lastThinkingPhrase);
  return lastThinkingPhrase;
}

export function randomNoAnswerPhrase(): string {
  lastNoAnswerPhrase = pickRandom(NO_ANSWER_PHRASES, lastNoAnswerPhrase);
  return lastNoAnswerPhrase;
}

// Module-level audio state so cancel() works across renders.
let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;
// True from stream open until every queued chunk has finished playing
// (including the cloud-synthesis fetch window, when no audio element exists
// yet) — so callers checking isSpeaking() can't fire a tick that cancels
// still-loading audio.
let pendingSpeech = false;
// Providers that return real synthesized audio, vs. the browser's own voice.
type CloudEngine = "elevenlabs" | "google" | "openai";
type TtsMode = CloudEngine | "system" | "none" | null;
let lastTtsMode: TtsMode = null;

function recordTtsMode(mode: TtsMode) {
  lastTtsMode = mode;
  useSession.getState().setLastTtsEngine(mode);
}

// Speech completion tracking — lets the session loop wait for audio to finish
// before scheduling the next tick, preventing mid-sentence cutoffs.
let speakDoneResolve: (() => void) | null = null;
let speakDonePromise: Promise<void> = Promise.resolve();

export function waitForSpeechEnd(maxWaitMs = 45_000): Promise<void> {
  // Safety net: never let a caller hang forever on a speech promise that a
  // future bug fails to resolve.
  return Promise.race([
    speakDonePromise,
    new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

export function getTtsMode(): TtsMode {
  return lastTtsMode;
}

export function isSpeaking(): boolean {
  return pendingSpeech;
}

/**
 * Stop speaking immediately, mid-word. This is barge-in: when the user starts
 * talking, the coach shuts up the same instant a person would. Also used when
 * a session is paused or stopped.
 */
export function cancelSpeech(): void {
  cancelCurrent();
}

function cancelCurrent() {
  speakGeneration++;
  pendingSpeech = false;
  speakDoneResolve?.(); // speech is done (cancelled) — unblock any waiters
  speakDoneResolve = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(label)), ms),
    ),
  ]);
}

type CloudAudio =
  | { ok: true; audioBase64: string; engine: CloudEngine }
  | { ok: false; message: string };

// Kick off cloud synthesis for one chunk. Called the moment a chunk is
// enqueued, so chunk N+1 synthesizes while chunk N is still playing.
// Cap on synthesis requests in flight at once.
//
// Speech is pipelined — chunk N+1 is synthesized while chunk N plays — which
// is what makes the coach feel responsive. But a fast multi-sentence response
// can put four requests in the air simultaneously, and ElevenLabs' free tier
// allows two. The rejected chunk downgrades the REST of that response to the
// system voice, so the coach starts well and then turns robotic mid-answer.
// Queuing instead costs nothing on paid plans (the pipeline is still a chunk
// ahead of playback) and prevents that entirely.
const MAX_CONCURRENT_SYNTHESIS = 2;

let inFlightSynthesis = 0;
const synthesisWaiters: Array<() => void> = [];

async function acquireSynthesisSlot(): Promise<void> {
  if (inFlightSynthesis < MAX_CONCURRENT_SYNTHESIS) {
    inFlightSynthesis++;
    return;
  }
  await new Promise<void>((resolve) => synthesisWaiters.push(resolve));
  inFlightSynthesis++;
}

function releaseSynthesisSlot(): void {
  inFlightSynthesis--;
  const next = synthesisWaiters.shift();
  if (next) next();
}

async function fetchCloudAudio(
  text: string,
  previousText: string,
): Promise<CloudAudio> {
  await acquireSynthesisSlot();
  try {
    // Bound the IPC round-trip. The main process already times out each TTS
    // provider, but this is a final guard so a stuck channel can never leave
    // playback hung — on timeout we fall through to the web-speech fallback.
    const result = await withTimeout(
      api().tts.speak(text, previousText),
      20_000,
      "tts_ipc_timeout",
    );
    if ("__error" in result) {
      const msg = (result as { message?: string }).message ?? "";
      console.warn("[SightLine TTS] cloud TTS error:", result.__error, msg);
      api().log(`[tts] cloud error: ${result.__error} ${msg}`.trim());
      return { ok: false, message: msg || result.__error };
    }
    return { ok: true, audioBase64: result.audioBase64, engine: result.engine };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[SightLine TTS] cloud TTS failed:", err);
    api().log(`[tts] cloud failed: ${msg}`);
    return { ok: false, message: msg };
  } finally {
    // Must release on every path — a leaked slot would permanently shrink the
    // pipeline and eventually deadlock all speech.
    releaseSynthesisSlot();
  }
}

// Play one synthesized chunk to completion. Resolves true if the audio
// played (or was cancelled mid-play), false if playback couldn't start —
// the caller then falls back to web speech.
function playAudioBuffer(
  audioBase64: string,
  engine: CloudEngine,
  gen: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (gen !== speakGeneration) {
      resolve(true); // cancelled while synthesizing
      return;
    }
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mp3" });
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    currentAudio = audio;

    // Shared end-of-life cleanup for ended/error/abort so a failed audio
    // element can never leave the queue pump hanging.
    let settled = false;
    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(blobUrl);
      if (currentAudio === audio) currentAudio = null;
      if (reason !== "ended" && gen === speakGeneration) {
        console.warn(`[SightLine TTS] audio ${reason} (gen ${gen})`);
        api().log(`[tts] audio ${reason} (gen ${gen})`);
      }
      resolve(true);
    };
    audio.onended = () => finish("ended");
    audio.onerror = () => finish("error");
    audio.onabort = () => finish("abort");

    audio.play().then(
      () => recordTtsMode(engine),
      (playErr) => {
        // Autoplay blocked or decode error — let the caller fall back.
        console.warn("[SightLine TTS] audio.play() failed:", playErr);
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(blobUrl);
        if (currentAudio === audio) currentAudio = null;
        resolve(false);
      },
    );
  });
}

function playWebSpeech(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    console.warn("[SightLine TTS] speechSynthesis not available.");
    return;
  }
  console.warn(
    "[SightLine TTS] Using system speech synthesis. Check your Google/OpenAI keys and network for the natural voice.",
  );

  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.0;
  utt.pitch = 1.0;

  function pickVoice(voices: SpeechSynthesisVoice[]) {
    const en = (v: SpeechSynthesisVoice) => v.lang.startsWith("en");
    return (
      voices.find((v) => v.name.includes("Natural") && en(v)) ??
      voices.find((v) => v.lang === "en-US") ??
      voices.find(en) ??
      null
    );
  }

  recordTtsMode("system");
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const v = pickVoice(voices);
    if (v) utt.voice = v;
    window.speechSynthesis.speak(utt);
  } else {
    // Voices haven't loaded yet — attach listener then speak.
    const handler = () => {
      window.speechSynthesis.onvoiceschanged = null;
      const v = pickVoice(window.speechSynthesis.getVoices());
      if (v) utt.voice = v;
      window.speechSynthesis.speak(utt);
    };
    window.speechSynthesis.onvoiceschanged = handler;
    // Safety net: if the event never fires, speak with default voice.
    window.setTimeout(() => {
      if (window.speechSynthesis.onvoiceschanged === handler) {
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.speak(utt);
      }
    }, 500);
  }
}

// A speech stream: sentences are enqueued as they arrive (from the streaming
// Claude response) and played strictly in order. Synthesis of chunk N+1
// starts the moment it's enqueued — while chunk N is still playing — so the
// gap between sentences is just the natural sentence pause.
export interface SpeechStream {
  enqueue(text: string): void;
  // No more chunks coming. waitForSpeechEnd() resolves once the queue drains.
  end(): void;
}

export function openSpeechStream(): SpeechStream {
  cancelCurrent(); // resolves previous promise, increments generation
  const gen = speakGeneration;
  pendingSpeech = true;
  speakDonePromise = new Promise<void>((resolve) => {
    speakDoneResolve = resolve;
  });
  lastTtsMode = null;

  interface QueueItem {
    text: string;
    audioPromise: Promise<CloudAudio>;
  }
  const queue: QueueItem[] = [];
  let ended = false;
  let pumping = false;
  // Everything enqueued so far in THIS response. Sent with each subsequent
  // chunk so the provider continues the same delivery rather than starting a
  // fresh performance every sentence — without it, intonation wanders and the
  // occasional sentence comes out shouted.
  let spokenSoFar = "";
  // Once one chunk falls back to the system voice, all later chunks in this
  // stream do too — speechSynthesis queues utterances natively, and mixing
  // voices mid-stream sounds broken.
  let degraded = false;

  const finishAll = () => {
    if (gen !== speakGeneration) return;
    pendingSpeech = false;
    speakDoneResolve?.();
    speakDoneResolve = null;
    api().log(`[tts] stream drained (gen ${gen})`);
  };

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        if (gen !== speakGeneration) return; // cancelled
        const item = queue.shift()!;
        const result = degraded
          ? ({ ok: false, message: "degraded" } as const)
          : await item.audioPromise;
        if (gen !== speakGeneration) return;
        if (result.ok) {
          const played = await playAudioBuffer(
            result.audioBase64,
            result.engine,
            gen,
          );
          if (played) continue;
        }
        if (!degraded) {
          degraded = true;
          api().log(`[tts] falling back to web speech (gen ${gen})`);
        }
        if (typeof window !== "undefined" && window.speechSynthesis) {
          playWebSpeech(item.text);
        } else {
          recordTtsMode("none");
        }
      }
      // Web Speech has no reliable end signal — once degraded, resolve as
      // soon as everything is handed off, matching the old behavior.
      if (ended && gen === speakGeneration) finishAll();
    } finally {
      pumping = false;
      if (gen === speakGeneration && queue.length > 0) void pump();
    }
  }

  return {
    enqueue(text: string) {
      if (gen !== speakGeneration || ended) return;
      const trimmed = preprocessForTts(text.trim());
      if (!trimmed) return;
      api().log(`[tts] enqueue (gen ${gen}): "${trimmed.slice(0, 40)}"`);
      // Capture the context BEFORE appending this chunk — the first chunk of a
      // response has no predecessor, which is also what keeps the warmed
      // phrase cache hitting for fillers.
      const previousText = spokenSoFar;
      spokenSoFar = spokenSoFar ? `${spokenSoFar} ${trimmed}` : trimmed;
      queue.push({
        text: trimmed,
        audioPromise: degraded
          ? Promise.resolve({ ok: false, message: "degraded" })
          : fetchCloudAudio(trimmed, previousText),
      });
      void pump();
    },
    end() {
      if (gen !== speakGeneration || ended) return;
      ended = true;
      if (!pumping && queue.length === 0) finishAll();
    },
  };
}

export function useTts() {
  function speak(text: string) {
    if (!text.trim()) return;
    const stream = openSpeechStream();
    stream.enqueue(text);
    stream.end();
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
