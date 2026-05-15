import { useCallback, useRef, useState } from "react";
import { api } from "../lib/api";

type VoiceState = "idle" | "recording" | "transcribing" | "error";

export function useVoice(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setState("transcribing");
        const blob = new Blob(chunksRef.current, { type: mime });
        const buffer = new Uint8Array(await blob.arrayBuffer());
        const base64 = bytesToBase64(buffer);
        try {
          const result = await api().whisper.transcribe({
            audioBase64: base64,
            mimeType: mime,
          });
          if ("__error" in (result as object)) {
            const err = result as { __error: string; message?: string };
            if (err.__error === "missing_openai_key") {
              setError("OpenAI API key not configured.");
            } else {
              setError(err.message ?? "Transcription failed.");
            }
            setState("error");
            return;
          }
          const text = (result as { text: string }).text;
          onTranscript(text);
          setState("idle");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [onTranscript]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  return { state, error, start, stop };
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    )
      return c;
  }
  return "audio/webm";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
