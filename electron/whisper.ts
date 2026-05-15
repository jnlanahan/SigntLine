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
  const result = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
  });
  return result.text.trim();
}

function pickExtension(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}
