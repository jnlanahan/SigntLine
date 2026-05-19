import OpenAI from "openai";
import { getKey } from "./credentials";

// "nova" — OpenAI's most natural, conversational voice
const VOICE = "nova" as const;

export async function speakText(text: string): Promise<Buffer> {
  const apiKey = await getKey("openai");
  if (!apiKey) throw new Error("missing_openai_key");

  const client = new OpenAI({ apiKey });
  const response = await client.audio.speech.create({
    model: "tts-1-hd",
    voice: VOICE,
    input: text,
    response_format: "mp3",
  });

  return Buffer.from(await response.arrayBuffer());
}
