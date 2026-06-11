import { api } from "../lib/api";
import { useSettings } from "../store/settings";

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
let lastTtsMode: "openai" | "system" | "none" | null = null;

// Speech completion tracking — lets the session loop wait for audio to finish
// before scheduling the next tick, preventing mid-sentence cutoffs.
let speakDoneResolve: (() => void) | null = null;
let speakDonePromise: Promise<void> = Promise.resolve();

export function waitForSpeechEnd(): Promise<void> {
  return speakDonePromise;
}

export function getTtsMode(): "openai" | "system" | "none" | null {
  return lastTtsMode;
}

export function isSpeaking(): boolean {
  return currentAudio !== null;
}

function cancelCurrent() {
  speakGeneration++;
  speakDoneResolve?.(); // speech is done (cancelled) — unblock any waiters
  speakDoneResolve = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

async function playOpenAI(text: string, gen: number): Promise<boolean> {
  try {
    const voice = useSettings.getState().settings?.ttsVoice;
    const result = await api().tts.speak(text, voice);
    if (gen !== speakGeneration) return true; // cancelled while waiting
    if ("__error" in result) {
      const msg = (result as { message?: string }).message ?? "";
      console.warn("[SightLine TTS] OpenAI error:", result.__error, msg);
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
    audio.onended = () => {
      URL.revokeObjectURL(blobUrl);
      if (currentAudio === audio) currentAudio = null;
      // Only resolve if this is still the active speech (gen guard prevents
      // a stale onended from resolving a newer instruction's promise).
      if (gen === speakGeneration) {
        speakDoneResolve?.();
        speakDoneResolve = null;
      }
    };

    try {
      await audio.play();
      lastTtsMode = "openai";
      return true;
    } catch (playErr) {
      // Autoplay blocked or decode error — fall through to Web Speech.
      console.warn("[SightLine TTS] audio.play() failed:", playErr);
      currentAudio = null;
      return false;
    }
  } catch (err) {
    console.warn("[SightLine TTS] OpenAI TTS failed:", err);
    return false;
  }
}

function playWebSpeech(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    console.warn("[SightLine TTS] speechSynthesis not available.");
    return;
  }
  console.warn(
    "[SightLine TTS] Using system speech synthesis. Add an OpenAI API key in Settings for the natural voice.",
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

  lastTtsMode = "system";
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
    // Create new completion promise for this speech instance.
    speakDonePromise = new Promise<void>((resolve) => {
      speakDoneResolve = resolve;
    });
    lastTtsMode = null;
    const gen = speakGeneration;

    void playOpenAI(trimmed, gen).then((used) => {
      if (!used && gen === speakGeneration) {
        playWebSpeech(trimmed);
        // Web Speech has no reliable end event — resolve immediately so the
        // session loop isn't stuck waiting indefinitely.
        speakDoneResolve?.();
        speakDoneResolve = null;
      } else if (!used) {
        lastTtsMode = "none";
        speakDoneResolve?.();
        speakDoneResolve = null;
      }
      // If used=true: audio is playing; onended will resolve the promise.
      // If gen !== speakGeneration: cancelCurrent() already resolved it.
    });
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
