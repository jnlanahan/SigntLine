import { useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";
import { ISend } from "../design/icons";
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
  const T = useTheme();
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

  const isRecording = voice.state === "recording";
  const isTranscribing = voice.state === "transcribing";
  const hasValue = value.trim().length > 0;

  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "center", gap: 6,
        background: lt(0.05), border: `1px solid ${lt(0.12)}`,
        borderRadius: 13, padding: "5px 6px 5px 14px",
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
        style={{
          flex: 1, minWidth: 0, border: 0, outline: "none",
          background: "transparent", color: T.ink,
          fontSize: 13.5, fontFamily: "inherit",
        }}
      />

      {/* Mic button */}
      <button
        type="button"
        onClick={() => (isRecording ? voice.stop() : voice.start())}
        disabled={isTranscribing}
        title={isRecording ? "Stop recording" : isTranscribing ? "Transcribing…" : "Voice input"}
        className="sl-ctrl"
        style={{
          width: 32, height: 32, border: 0, borderRadius: 9, cursor: isTranscribing ? "default" : "pointer",
          background: isRecording ? "rgba(239,68,68,0.15)" : "transparent",
          color: isRecording ? "#ef4444" : T.ink2,
          display: "grid", placeItems: "center", opacity: isTranscribing ? 0.5 : 1,
        }}
      >
        {isRecording ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444" }}>● REC</span>
        ) : isTranscribing ? (
          <span style={{ fontSize: 10, color: T.ink3 }}>…</span>
        ) : (
          <MicIcon c={T.ink2} />
        )}
      </button>

      {/* Send button */}
      <button
        type="button"
        onClick={submit}
        disabled={!hasValue}
        title="Send"
        style={{
          width: 32, height: 32, border: 0, borderRadius: 9,
          background: hasValue ? `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})` : lt(0.06),
          color: hasValue ? T.onAccent : T.ink3,
          display: "grid", placeItems: "center",
          cursor: hasValue ? "pointer" : "default",
          opacity: hasValue ? 1 : 0.5,
          boxShadow: hasValue ? `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}` : "none",
          transition: "all 150ms",
        }}
      >
        {queued ? (
          <span style={{ fontSize: 11, fontWeight: 700 }}>✓</span>
        ) : (
          <ISend c={hasValue ? T.onAccent : T.ink3} />
        )}
      </button>
    </div>
  );
}

function MicIcon({ c }: { c?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="5" y="1.5" width="4" height="7" rx="2" stroke={c || "currentColor"} strokeWidth="1.4" />
      <path d="M2.5 7c0 2.5 2 4.5 4.5 4.5S11.5 9.5 11.5 7M7 11.5v1.5" stroke={c || "currentColor"} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
