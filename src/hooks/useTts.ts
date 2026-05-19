import { api } from "../lib/api";

export const WAITING_PHRASES = [
  "Hey, no rush at all — I'm right here watching your screen. Just go ahead, and I'll notice when you've done it. Or just let me know when you're ready!",
  "Take your time with that. I'll be right here keeping an eye on things, and I'll jump back in as soon as I see something change.",
  "Go ahead and give that a try! I'm watching your screen and I'll be right here when you're done — no need to hurry.",
  "I'll just hang tight! I'm keeping an eye on your screen and I'll check in as soon as I see you've made a move.",
];

export const SCREEN_CHANGE_PHRASES = [
  "Oh nice, I can see something changed there! Give me just a second to take a look...",
  "Hey, looks like you did something! Hang on, let me check in and see where things are...",
  "I noticed a change on your screen — let me take a quick peek at what you've done!",
];

export function randomWaitingPhrase(): string {
  return WAITING_PHRASES[Math.floor(Math.random() * WAITING_PHRASES.length)];
}

export function randomScreenChangePhrase(): string {
  return SCREEN_CHANGE_PHRASES[Math.floor(Math.random() * SCREEN_CHANGE_PHRASES.length)];
}

// Module-level audio state so cancel() works across renders
let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;

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
    const result = await api().tts.speak(text);
    if (gen !== speakGeneration) return true; // cancelled while waiting
    if ("__error" in result) return false; // no key or failed — fall through to Web Speech

    const audio = new Audio(`data:audio/mp3;base64,${result.audioBase64}`);
    if (gen !== speakGeneration) return true; // cancelled after IPC returned
    currentAudio = audio;
    void audio.play();
    audio.onended = () => { if (currentAudio === audio) currentAudio = null; };
    return true;
  } catch {
    return false;
  }
}

function playWebSpeech(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  const en = (v: SpeechSynthesisVoice) => v.lang.startsWith("en");
  const voice =
    voices.find((v) => v.name === "Google US English") ??
    voices.find((v) => v.name.includes("Google") && en(v)) ??
    voices.find((v) => v.name.includes("Natural") && en(v)) ??
    voices.find((v) => v.lang === "en-US") ??
    null;
  const utt = new SpeechSynthesisUtterance(text);
  if (voice) utt.voice = voice;
  utt.rate = 0.92;
  window.speechSynthesis.speak(utt);
}

export function useTts() {
  function speak(text: string, followUp?: string) {
    cancelCurrent();
    const gen = speakGeneration;
    const fullText = followUp ? `${text} ${followUp}` : text;

    void playOpenAI(fullText, gen).then((used) => {
      if (!used && gen === speakGeneration) playWebSpeech(fullText);
    });
  }

  function cancel() {
    cancelCurrent();
  }

  return { speak, cancel };
}
