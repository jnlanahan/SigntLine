import { useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { api } from "../lib/api";
import { useTheme } from "../design/ThemeProvider";
import { Eyebrow } from "../design/primitives";
import { ar, lt } from "../design/theme";
import type { AppMode } from "../lib/api";

export interface Clarification {
  question: string;
  answer: string;
}

interface Props {
  mode: AppMode;
  onStart(goal: string, clarifications: Clarification[]): void;
  onBack(): void;
}

const PROMPT_COPY: Record<AppMode, { label: string; placeholder: string }> = {
  tech_support: {
    label:       "What do you want help with?",
    placeholder: 'e.g. "Help me set up S3 storage in AWS" or "Walk me through partitioning my hard drive"',
  },
  training: {
    label:       "What do you want to build a training plan for?",
    placeholder: 'e.g. "Onboarding new support reps" or "How our team files expense reports"',
  },
  teacher: {
    label:       "What do you want to learn?",
    placeholder: 'e.g. "This machine-learning paper" or "Chapter 4 of my statistics textbook"',
  },
};

export function GoalPrompt({ mode, onStart, onBack }: Props) {
  const T = useTheme();
  const copy = PROMPT_COPY[mode];
  const [value, setValue]               = useState("");
  const [phase, setPhase]               = useState<"input" | "clarifying">("input");
  const [questions, setQuestions]       = useState<string[]>([]);
  const [answers, setAnswers]           = useState<string[]>([]);
  const [loadingClarify, setLoadingClarify] = useState(false);

  const voice = useVoice((text) =>
    setValue((prev) => (prev ? `${prev} ${text}` : text)),
  );

  async function handleStart() {
    const t = value.trim();
    if (!t) return;
    setLoadingClarify(true);
    try {
      const result = await api().claude.getClarifications({ mode, goal: t });
      if ("questions" in result && result.questions.length > 0) {
        setQuestions(result.questions);
        setAnswers(new Array(result.questions.length).fill(""));
        setPhase("clarifying");
        return;
      }
    } catch {
      // fail-safe: skip clarification
    } finally {
      setLoadingClarify(false);
    }
    onStart(t, []);
  }

  function handleSubmitClarifications() {
    const clarifications: Clarification[] = questions.map((q, i) => ({
      question: q,
      answer: answers[i] ?? "",
    }));
    onStart(value.trim(), clarifications);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: `1px solid ${lt(0.10)}`,
    background: lt(0.04), borderRadius: 11,
    padding: "9px 12px", fontSize: 13.5, color: T.ink,
    outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  };

  if (phase === "clarifying") {
    return (
      <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Eyebrow>A few quick questions to get started</Eyebrow>
        {questions.map((q, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12.5, color: T.ink2 }}>{q}</label>
            <input
              type="text"
              value={answers[i] ?? ""}
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                setAnswers(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (i === questions.length - 1) handleSubmitClarifications();
                  else {
                    const nextInput = document.querySelectorAll<HTMLInputElement>(".clarify-input")[i + 1];
                    nextInput?.focus();
                  }
                }
              }}
              className="clarify-input no-drag"
              style={inputStyle}
              placeholder="(optional)"
              autoFocus={i === 0}
            />
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <button
            type="button"
            onClick={() => onStart(value.trim(), [])}
            style={{
              borderRadius: 9, border: `1px solid ${lt(0.08)}`,
              background: "transparent", color: T.ink3,
              fontSize: 12, padding: "7px 14px", cursor: "pointer",
              transition: "color 150ms",
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmitClarifications}
            style={{
              marginLeft: "auto", borderRadius: 9, border: 0,
              background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
              color: T.onAccent,
              fontSize: 12, fontWeight: 600, padding: "7px 18px",
              cursor: "pointer",
              boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
            }}
          >
            Start session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          alignSelf: "flex-start", border: 0, background: "transparent",
          fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink3,
          cursor: "pointer", padding: 0, transition: "color 150ms",
        }}
      >
        ← Change mode
      </button>
      <Eyebrow>{copy.label}</Eyebrow>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleStart();
          }
        }}
        rows={3}
        placeholder={copy.placeholder}
        className="sl-scroll no-drag"
        style={{ ...inputStyle, resize: "none" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
          disabled={voice.state === "transcribing"}
          style={{
            borderRadius: 9, border: `1px solid ${lt(0.10)}`,
            background: voice.state === "recording" ? "rgba(239,68,68,0.12)" : lt(0.04),
            color: voice.state === "recording" ? "#ef4444" : T.ink2,
            fontSize: 12, fontWeight: 500, padding: "7px 14px",
            cursor: voice.state === "transcribing" ? "default" : "pointer",
            opacity: voice.state === "transcribing" ? 0.5 : 1,
          }}
        >
          {voice.state === "recording"
            ? "● Stop"
            : voice.state === "transcribing"
              ? "Transcribing…"
              : "🎤 Speak"}
        </button>
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={value.trim().length === 0 || loadingClarify}
          style={{
            marginLeft: "auto", borderRadius: 9, border: 0,
            background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
            color: T.onAccent,
            fontSize: 12, fontWeight: 600, padding: "7px 20px",
            cursor: "pointer",
            opacity: value.trim().length === 0 || loadingClarify ? 0.4 : 1,
            boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
            transition: "opacity 150ms",
          }}
        >
          {loadingClarify ? "…" : "Start session"}
        </button>
      </div>
      {voice.error && (
        <p style={{ fontSize: 11, color: "#ef4444", margin: 0 }}>{voice.error}</p>
      )}
    </div>
  );
}
