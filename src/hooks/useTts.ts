import { api } from "../lib/api";
import { useSettings } from "../store/settings";
import { useSession } from "../store/session";

// Spoken when the user has been idle for a while with no screen change.
export const WAITING_PHRASES = [
  "No rush — take your time.",
  "Still here whenever you're ready.",
  "Go ahead and give that a try.",
  "Take a sec, I'm not going anywhere.",
  "Whenever you're ready, I'll pick it up.",
  "Feel free to ask if anything's unclear.",
  "I'm watching — take as long as you need.",
  "No rush — just ask if you get stuck.",
];

// Spoken on goal completion.
export const COMPLETION_PHRASES = [
  "And that's a wrap. Nice work.",
  "Done. Not bad at all.",
  "Nailed it — you're all set.",
  "That's the whole thing. Well played.",
  "Goal achieved. See? Wasn't so bad.",
];

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

export function randomWaitingPhrase(): string {
  lastWaitingPhrase = pickRandom(WAITING_PHRASES, lastWaitingPhrase);
  return lastWaitingPhrase;
}

export function randomCompletionPhrase(): string {
  lastCompletionPhrase = pickRandom(COMPLETION_PHRASES, lastCompletionPhrase);
  return lastCompletionPhrase;
}

// Module-level audio state so cancel() works across renders.
let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;
// True from speak() until the audio definitively ends (including the 1-2s
// cloud-synthesis fetch, when no audio element exists yet) — so callers
// checking isSpeaking() can't fire a tick that cancels still-loading audio.
let pendingSpeech = false;
type TtsMode = "google" | "openai" | "system" | "none" | null;
let lastTtsMode: TtsMode = null;

function recordTtsMode(mode: TtsMode) {
  lastTtsMode = mode;
  useSession.getState().setLastTtsEngine(mode);
}

// Speech completion tracking — lets the session loop wait for audio to finish
// before scheduling the next tick, preventing mid-sentence cutoffs.
let speakDoneResolve: (() => void) | null = null;
let speakDonePromise: Promise<void> = Promise.resolve();

export function waitForSpeechEnd(maxWaitMs = 30_000): Promise<void> {
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

async function playCloud(text: string, gen: number): Promise<boolean> {
  try {
    const voice = useSettings.getState().settings?.ttsVoice;
    // Bound the IPC round-trip. The main process already times out each TTS
    // engine, but this is a final guard so a stuck channel can never leave
    // playback hung — on timeout we fall through to the web-speech fallback.
    const result = await withTimeout(
      api().tts.speak(text, voice),
      18_000,
      "tts_ipc_timeout",
    );
    if (gen !== speakGeneration) return true; // cancelled while waiting
    if ("__error" in result) {
      const msg = (result as { message?: string }).message ?? "";
      console.warn("[SightLine TTS] cloud TTS error:", result.__error, msg);
      api().log(`[tts] cloud error: ${result.__error} ${msg}`.trim());
      return false;
    }

    const bytes = Uint8Array.from(atob(result.audioBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mp3" });
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    if (gen !== speakGeneration) {
      URL.revokeObjectURL(blobUrl);
      return true; // cancelled after IPC returned
    }
    currentAudio = audio;

    // Shared end-of-life cleanup for ended/error/abort, so a failed audio
    // element can never leave isSpeaking() stuck true or the session loop
    // hanging on waitForSpeechEnd().
    const finish = (reason: string) => {
      URL.revokeObjectURL(blobUrl);
      if (currentAudio === audio) currentAudio = null;
      // Only resolve if this is still the active speech (gen guard prevents
      // a stale event from resolving a newer instruction's promise).
      if (gen === speakGeneration) {
        pendingSpeech = false;
        speakDoneResolve?.();
        speakDoneResolve = null;
        if (reason !== "ended") {
          console.warn(`[SightLine TTS] audio ${reason} (gen ${gen})`);
          api().log(`[tts] audio ${reason} (gen ${gen})`);
        } else {
          api().log(`[tts] audio ended (gen ${gen})`);
        }
      }
    };
    audio.onended = () => finish("ended");
    audio.onerror = () => finish("error");
    audio.onabort = () => finish("abort");

    try {
      await audio.play();
      recordTtsMode(result.engine);
      return true;
    } catch (playErr) {
      // Autoplay blocked or decode error — fall through to Web Speech.
      console.warn("[SightLine TTS] audio.play() failed:", playErr);
      currentAudio = null;
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[SightLine TTS] cloud TTS failed:", err);
    api().log(`[tts] cloud failed: ${msg}`);
    return false;
  }
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

function preprocessForTts(text: string): string {
  return text
    .replace(/^(Okay|Alright|Cool|Nice|Right|Great|Got it|Perfect)(\s+)/i, "$1,$2")
    .replace(/ — /g, ", ")
    .replace(/\.{3}$/, ".");
}

export function useTts() {
  function speak(text: string) {
    const trimmed = preprocessForTts(text.trim());
    if (!trimmed) return;
    cancelCurrent(); // resolves previous promise, increments generation
    pendingSpeech = true; // covers the cloud-synthesis fetch window too
    // Create new completion promise for this speech instance.
    speakDonePromise = new Promise<void>((resolve) => {
      speakDoneResolve = resolve;
    });
    lastTtsMode = null;
    const gen = speakGeneration;
    api().log(`[tts] speak start (gen ${gen}): "${trimmed.slice(0, 40)}"`);

    void playCloud(trimmed, gen).then((used) => {
      if (!used && gen === speakGeneration) {
        api().log(`[tts] falling back to web speech (gen ${gen})`);
        playWebSpeech(trimmed);
        // Web Speech has no reliable end event — resolve immediately so the
        // session loop isn't stuck waiting indefinitely.
        pendingSpeech = false;
        speakDoneResolve?.();
        speakDoneResolve = null;
      } else if (!used) {
        recordTtsMode("none");
        pendingSpeech = false;
        speakDoneResolve?.();
        speakDoneResolve = null;
      }
      // If used=true: audio is playing; finish() will resolve the promise.
      // If gen !== speakGeneration: cancelCurrent() already resolved it.
    });
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
