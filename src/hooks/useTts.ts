import { api } from "../lib/api";
import { useSettings } from "../store/settings";

// Spoken when the user has been idle for a while with no screen change.
// Variety matters here — these play in the same context repeatedly.
export const WAITING_PHRASES = [
  "No rush — I'm right here whenever you're ready.",
  "Take your time, I'll be watching.",
  "Whenever you're ready to give that a try, I'll see it.",
  "Go ahead — I'll keep an eye out and chime in once you do.",
  "Still here. Just let me know if anything's confusing.",
  "Take a sec — I'll notice as soon as you make a move.",
  "All good. I'm waiting on you when you're ready.",
];

// Spoken once when SightLine notices the screen change after a quiet period.
export const SCREEN_CHANGE_PHRASES = [
  "Got it — let me see where you're at.",
  "Okay, looks like something changed. One sec.",
  "Nice — checking what you've done.",
  "Cool, let me catch up.",
  "Alright, taking a look now.",
];

// Spoken on goal completion.
export const COMPLETION_PHRASES = [
  "Nice work — that's it, you're done.",
  "And… you're all set. Great job.",
  "Done deal. Nicely handled.",
  "That's the whole task — well done.",
];

function pickRandom<T>(arr: readonly T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  let next = arr[Math.floor(Math.random() * arr.length)];
  // Avoid repeating the most-recent phrase back-to-back.
  if (avoid !== undefined && next === avoid) {
    next = arr[(arr.indexOf(next) + 1) % arr.length];
  }
  return next;
}

let lastWaitingPhrase: string | undefined;
let lastScreenChangePhrase: string | undefined;
let lastCompletionPhrase: string | undefined;

export function randomWaitingPhrase(): string {
  lastWaitingPhrase = pickRandom(WAITING_PHRASES, lastWaitingPhrase);
  return lastWaitingPhrase;
}

export function randomScreenChangePhrase(): string {
  lastScreenChangePhrase = pickRandom(SCREEN_CHANGE_PHRASES, lastScreenChangePhrase);
  return lastScreenChangePhrase;
}

export function randomCompletionPhrase(): string {
  lastCompletionPhrase = pickRandom(COMPLETION_PHRASES, lastCompletionPhrase);
  return lastCompletionPhrase;
}

// Module-level audio state so cancel() works across renders.
let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;
let webSpeechWarned = false;

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
    if ("__error" in result) return false; // no key or failed — fall through

    const audio = new Audio(`data:audio/mp3;base64,${result.audioBase64}`);
    if (gen !== speakGeneration) return true; // cancelled after IPC returned
    currentAudio = audio;
    void audio.play();
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
    };
    return true;
  } catch {
    return false;
  }
}

function playWebSpeech(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (!webSpeechWarned) {
    webSpeechWarned = true;
    console.warn(
      "[SightLine] Falling back to system speech synthesis. Add an OpenAI API key in Settings for the natural voice.",
    );
  }
  const voices = window.speechSynthesis.getVoices();
  const en = (v: SpeechSynthesisVoice) => v.lang.startsWith("en");
  const voice =
    voices.find((v) => v.name.includes("Natural") && en(v)) ??
    voices.find((v) => v.name === "Microsoft Aria Online (Natural) - English (United States)") ??
    voices.find((v) => v.name === "Google US English") ??
    voices.find((v) => v.name.includes("Google") && en(v)) ??
    voices.find((v) => v.lang === "en-US") ??
    null;
  const utt = new SpeechSynthesisUtterance(text);
  if (voice) utt.voice = voice;
  utt.rate = 1.0;
  utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
}

export function useTts() {
  function speak(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    cancelCurrent();
    const gen = speakGeneration;

    void playOpenAI(trimmed, gen).then((used) => {
      if (!used && gen === speakGeneration) playWebSpeech(trimmed);
    });
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
