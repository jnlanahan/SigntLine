import { useState } from "react";
import { useVoice } from "../hooks/useVoice";

interface Props {
  onStart(goal: string): void;
}

export function GoalPrompt({ onStart }: Props) {
  const [value, setValue] = useState("");
  const voice = useVoice((text) =>
    setValue((prev) => (prev ? `${prev} ${text}` : text)),
  );

  function start() {
    const t = value.trim();
    if (!t) return;
    onStart(t);
  }

  return (
    <div className="no-drag flex flex-col gap-2">
      <label className="text-[11px] uppercase tracking-wide text-neutral-400">
        What do you want help with?
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            start();
          }
        }}
        rows={3}
        placeholder='e.g. "Help me set up an S3 bucket" or "Walk me through partitioning my hard drive"'
        className="sl-scroll w-full resize-none rounded-md border border-panel-border bg-black/30 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-accent focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() =>
            voice.state === "recording" ? voice.stop() : voice.start()
          }
          disabled={voice.state === "transcribing"}
          className={`rounded-md border border-panel-border px-2 py-1 text-xs ${
            voice.state === "recording"
              ? "bg-error/30 text-error"
              : "bg-black/30 text-neutral-200 hover:bg-black/50"
          } disabled:opacity-50`}
        >
          {voice.state === "recording"
            ? "● Stop"
            : voice.state === "transcribing"
              ? "Transcribing…"
              : "🎤 Speak"}
        </button>
        <button
          onClick={start}
          disabled={value.trim().length === 0}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Start session
        </button>
      </div>
      {voice.error && (
        <p className="text-[11px] text-error">{voice.error}</p>
      )}
    </div>
  );
}
