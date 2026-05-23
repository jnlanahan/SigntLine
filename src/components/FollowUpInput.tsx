import { useState } from "react";
import { useVoice } from "../hooks/useVoice";
import type { AppMode } from "../lib/api";

const PLACEHOLDER: Record<AppMode, string> = {
  tech_support: "Ask a follow-up…",
  training:     "Ask a question or say 'done' when the plan is complete",
  teacher:      "Ask a question or tell Claude what to explore next",
};

interface Props {
  isThinking: boolean;
  mode: AppMode | null;
  onSubmit(text: string): void;
}

export function FollowUpInput({ isThinking, mode, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [queued, setQueued] = useState(false);
  const voice = useVoice((text) => {
    setValue((prev) => (prev ? `${prev} ${text}` : text));
  });

  function submit() {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
    if (isThinking) {
      setQueued(true);
      window.setTimeout(() => setQueued(false), 1500);
    }
  }

  return (
    <div
      className="no-drag flex items-center gap-2 rounded-xl border px-3 py-1.5"
      style={{
        borderColor: "rgba(244,232,218,0.10)",
        background: "rgba(244,232,218,0.04)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <input
        type="text"
        value={value}
        placeholder={queued ? "Queued — will send when done…" : PLACEHOLDER[mode ?? "tech_support"]}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="flex-1 bg-transparent text-sm text-sl-ink placeholder:text-sl-ink3 focus:outline-none"
      />

      {/* Mic button */}
      <button
        type="button"
        onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
        disabled={voice.state === "transcribing"}
        title={
          voice.state === "recording"
            ? "Stop recording"
            : voice.state === "transcribing"
              ? "Transcribing…"
              : "Voice input"
        }
        className="flex items-center justify-center rounded-lg p-1.5 transition disabled:opacity-50"
        style={{
          background:
            voice.state === "recording"
              ? "rgba(239,68,68,0.15)"
              : "transparent",
          color:
            voice.state === "recording"
              ? "#ef4444"
              : "#7A6E63",
          border: 0,
          cursor: voice.state === "transcribing" ? "default" : "pointer",
        }}
      >
        {voice.state === "recording" ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444" }}>● REC</span>
        ) : voice.state === "transcribing" ? (
          <span style={{ fontSize: 10, color: "#7A6E63" }}>…</span>
        ) : (
          <MicIcon />
        )}
      </button>

      {/* Send button */}
      <button
        type="button"
        onClick={submit}
        disabled={value.trim().length === 0}
        className="flex items-center justify-center rounded-lg transition"
        style={{
          width: 28, height: 28,
          border: 0,
          background: value.trim() ? "#8FC4EC" : "rgba(244,232,218,0.06)",
          color: value.trim() ? "#0d1117" : "#7A6E63",
          cursor: value.trim() ? "pointer" : "default",
          opacity: value.trim() ? 1 : 0.6,
        }}
      >
        {queued ? (
          <span style={{ fontSize: 11, fontWeight: 700 }}>✓</span>
        ) : (
          <ArrowUpIcon active={value.trim().length > 0} />
        )}
      </button>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="5" y="1.5" width="4" height="7" rx="2" stroke="#7A6E63" strokeWidth="1.4" />
      <path d="M2.5 7c0 2.5 2 4.5 4.5 4.5S11.5 9.5 11.5 7M7 11.5v1.5" stroke="#7A6E63" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUpIcon({ active }: { active: boolean }) {
  const c = active ? "#0d1117" : "#7A6E63";
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M7 11V3M3.5 6.5L7 3l3.5 3.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
