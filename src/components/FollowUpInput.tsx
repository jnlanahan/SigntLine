import { useState } from "react";
import { useVoice } from "../hooks/useVoice";

interface Props {
  disabled: boolean;
  onSubmit(text: string): void;
}

export function FollowUpInput({ disabled, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const voice = useVoice((text) => {
    setValue((prev) => (prev ? `${prev} ${text}` : text));
  });

  function submit() {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
  }

  return (
    <div className="no-drag flex items-center gap-1.5 rounded-md border border-panel-border bg-black/30 px-2 py-1">
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder="Ask a follow-up…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="flex-1 bg-transparent text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
        disabled={disabled || voice.state === "transcribing"}
        className={`rounded px-1.5 py-0.5 text-[11px] transition ${
          voice.state === "recording"
            ? "bg-error/30 text-error"
            : "text-neutral-300 hover:bg-white/10"
        } disabled:opacity-50`}
        title={
          voice.state === "recording"
            ? "Stop recording"
            : voice.state === "transcribing"
              ? "Transcribing…"
              : "Voice input (Whisper)"
        }
      >
        {voice.state === "recording" ? "● rec" : voice.state === "transcribing" ? "…" : "🎤"}
      </button>
      <button
        onClick={submit}
        disabled={disabled || value.trim().length === 0}
        className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
