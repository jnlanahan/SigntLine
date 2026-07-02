import OpenAI from "openai";
import { getKey } from "./credentials";

export class MissingOpenAIKeyError extends Error {
  constructor() {
    super("OpenAI API key is not configured");
    this.name = "MissingOpenAIKeyError";
  }
}

export interface TranscribeArgs {
  // base64-encoded webm/ogg/wav audio (without data URL prefix)
  audioBase64: string;
  mimeType: string;
}

export async function transcribe(args: TranscribeArgs): Promise<string> {
  const apiKey = await getKey("openai");
  if (!apiKey) throw new MissingOpenAIKeyError();

  const client = new OpenAI({ apiKey });
  const buffer = Buffer.from(args.audioBase64, "base64");
  const ext = pickExtension(args.mimeType);
  const file = await OpenAI.toFile(buffer, `audio.${ext}`, {
    type: args.mimeType,
  });
  // gpt-4o-mini-transcribe is faster and more accurate than whisper-1 for
  // short voice commands; fall back if the account lacks access.
  try {
    const result = await client.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
    });
    return result.text.trim();
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 404 || status === 400 || status === 422) {
      const result = await client.audio.transcriptions.create({
        model: "whisper-1",
        file,
      });
      return result.text.trim();
    }
    throw err;
  }
}

function pickExtension(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}
