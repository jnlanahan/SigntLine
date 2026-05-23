import OpenAI from "openai";
import { getKey } from "./credentials";

export type TtsVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "shimmer"
  | "coral"
  | "sage";

type SupportedVoice = "alloy" | "echo" | "fable" | "nova" | "onyx" | "shimmer";

export interface SpeakOptions {
  voice?: TtsVoice;
}

const TONE_INSTRUCTIONS =
  "Speak with energy and a friendly edge — like a sharp, enthusiastic friend who actually knows what they're talking about. " +
  "Be warm but direct. Vary your pacing and let a bit of personality come through. " +
  "Not robotic, not overly peppy — just real and slightly quick-witted.";

function toSupportedVoice(voice: TtsVoice): SupportedVoice {
  switch (voice) {
    case "coral":
      return "shimmer";
    case "sage":
      return "nova";
    default:
      return voice;
  }
}

export async function speakText(
  text: string,
  opts: SpeakOptions = {},
): Promise<Buffer> {
  const apiKey = await getKey("openai");
  if (!apiKey) throw new Error("missing_openai_key");

  const client = new OpenAI({ apiKey });
  const voice = toSupportedVoice(opts.voice ?? "nova");

  // Try the expressive model first — it accepts tone instructions and sounds
  // noticeably more human. Falls back to tts-1-hd if the account lacks access.
  try {
    const response = await client.audio.speech.create({
      model: "gpt-4o-mini-tts" as "tts-1-hd",
      voice,
      input: text,
      response_format: "mp3",
      instructions: TONE_INSTRUCTIONS,
    });
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404 || status === 400 || status === 422) {
      const response = await client.audio.speech.create({
        model: "tts-1-hd",
        voice,
        input: text,
        response_format: "mp3",
      });
      return Buffer.from(await response.arrayBuffer());
    }
    throw err;
  }
}
