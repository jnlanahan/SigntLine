import { api } from "../lib/api";
import { useSettings } from "../store/settings";

// Spoken when the user has been idle for a while with no screen change.
export const WAITING_PHRASES = [
  "No rush — I'm right here whenever you're ready.",
  "Take your time, I'll be watching.",
  "Whenever you're ready to give that a try, I'll see it.",
  "Go ahead — I'll keep an eye out and chime in once you do.",
  "Still here. Just let me know if anything's confusing.",
  "Take a sec — I'll notice as soon as you make a move.",
  "All good. I'm waiting on you when you're ready.",
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

export function getTtsMode(): "openai" | "system" | "none" | null {
  return lastTtsMode;
}

function cancelCurrent() {
  speakGeneration++;
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

export function useTts() {
  function speak(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    cancelCurrent();
    lastTtsMode = null;
    const gen = speakGeneration;

    void playOpenAI(trimmed, gen).then((used) => {
      if (!used && gen === speakGeneration) {
        playWebSpeech(trimmed);
      } else if (!used) {
        lastTtsMode = "none";
      }
    });
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
