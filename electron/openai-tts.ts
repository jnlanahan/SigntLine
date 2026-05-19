import OpenAI from "openai";
import { getKey } from "./credentials";

const TONE_INSTRUCTIONS =
  "Speak in a warm, natural, conversational tone — like a friendly mentor sitting next to the user. " +
  "Use easy pacing with brief, human pauses between thoughts. Sound encouraging and genuine, never robotic or formal. " +
  "Vary your intonation; let small interjections like 'okay', 'so', or 'alright' feel relaxed.";

export type TtsVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "shimmer"
  | "coral"
  | "sage";

export interface SpeakOptions {
  voice?: TtsVoice;
}

export async function speakText(
  text: string,
  opts: SpeakOptions = {},
): Promise<Buffer> {
  const apiKey = await getKey("openai");
  if (!apiKey) throw new Error("missing_openai_key");

  const client = new OpenAI({ apiKey });
  const voice = opts.voice ?? "nova";

  // Prefer the newer gpt-4o-mini-tts model, which accepts free-form tone
  // instructions and sounds noticeably more human. Fall back to tts-1-hd
  // if the account doesn't have access yet.
  try {
    const response = await (client.audio.speech.create as unknown as (
      p: Record<string, unknown>,
    ) => Promise<Response>)({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "mp3",
      instructions: TONE_INSTRUCTIONS,
    });
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // 404 / 400 / model_not_found → fall back to the widely-available HD model.
    if (status === 404 || status === 400) {
      const response = await client.audio.speech.create({
        model: "tts-1-hd",
        voice: coerceToLegacyVoice(voice),
        input: text,
        response_format: "mp3",
      });
      return Buffer.from(await response.arrayBuffer());
    }
    throw err;
  }
}

// tts-1-hd doesn't accept the newer voices ("coral", "sage"). Map them to
// the closest classic voice so the fallback still works.
function coerceToLegacyVoice(
  voice: TtsVoice,
): "alloy" | "echo" | "fable" | "nova" | "onyx" | "shimmer" {
  switch (voice) {
    case "coral":
      return "shimmer";
    case "sage":
      return "nova";
    default:
      return voice;
  }
}
