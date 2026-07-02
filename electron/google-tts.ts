import textToSpeech from "@google-cloud/text-to-speech";

// Chirp 3 HD voices — Google's most natural generation (NotebookLM-style).
// Leda is the warmest, most conversational of the female voices — the best
// fit for a coach sitting next to you — so it backs the default option.
const VOICE_MAP: Record<string, string> = {
  nova: "en-US-Chirp3-HD-Leda",
  coral: "en-US-Chirp3-HD-Leda",
  shimmer: "en-US-Chirp3-HD-Aoede",
  fable: "en-US-Chirp3-HD-Aoede",
  onyx: "en-US-Chirp3-HD-Charon",
  alloy: "en-US-Chirp3-HD-Charon",
  echo: "en-US-Chirp3-HD-Puck",
  sage: "en-US-Chirp3-HD-Puck",
};

const DEFAULT_VOICE = "en-US-Chirp3-HD-Leda";

export function hasGoogleCredentials(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_PROJECT_ID
  );
}

// Lazy singleton — constructing the client per call adds connection setup
// latency to every utterance.
let client: InstanceType<typeof textToSpeech.TextToSpeechClient> | null = null;

function getClient() {
  if (client) return client;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId = process.env.GOOGLE_PROJECT_ID;

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error("missing_google_credentials");
  }

  client = new textToSpeech.TextToSpeechClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });
  return client;
}

export async function speakTextGoogle(
  text: string,
  voice?: string,
): Promise<Buffer> {
  const voiceName = (voice && VOICE_MAP[voice]) ? VOICE_MAP[voice] : DEFAULT_VOICE;

  // Chirp 3 HD voices reject SSML — plain text only; their prosody is native.
  // The explicit per-call timeout matters: without it a wedged gRPC channel can
  // hang this call forever, which silently kills TTS for the rest of the
  // session (no error is thrown, so the OpenAI/system fallback never runs).
  const [response] = await getClient().synthesizeSpeech(
    {
      input: { text },
      voice: { languageCode: "en-US", name: voiceName },
      audioConfig: {
        audioEncoding: "MP3" as const,
        speakingRate: 1.0,
      },
    },
    { timeout: 8000 },
  );

  return Buffer.from(response.audioContent as Uint8Array);
}
