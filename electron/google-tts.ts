import textToSpeech from "@google-cloud/text-to-speech";

// Studio voices sound the most human — map our voice IDs to them.
const VOICE_MAP: Record<string, string> = {
  nova: "en-US-Studio-O",
  shimmer: "en-US-Studio-O",
  coral: "en-US-Studio-O",
  fable: "en-US-Studio-O",
  sage: "en-US-Studio-Q",
  alloy: "en-US-Studio-Q",
  echo: "en-US-Studio-Q",
  onyx: "en-US-Studio-Q",
};

export function hasGoogleCredentials(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_PROJECT_ID
  );
}

export async function speakTextGoogle(
  text: string,
  voice?: string,
): Promise<Buffer> {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId = process.env.GOOGLE_PROJECT_ID;

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error("missing_google_credentials");
  }

  const client = new textToSpeech.TextToSpeechClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });

  const voiceName = (voice && VOICE_MAP[voice]) ? VOICE_MAP[voice] : "en-US-Studio-O";

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: "en-US", name: voiceName },
    audioConfig: {
      audioEncoding: "MP3" as const,
      speakingRate: 1.0,
      volumeGainDb: 2.0,
    },
  });

  return Buffer.from(response.audioContent as Uint8Array);
}
