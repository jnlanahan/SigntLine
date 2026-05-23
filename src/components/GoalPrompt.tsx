import { useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { api } from "../lib/api";
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

  if (phase === "clarifying") {
    return (
      <div className="no-drag flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-sl-ink3">
          A few quick questions to get started
        </p>
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <label className="text-xs text-sl-ink2">{q}</label>
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
              className="clarify-input no-drag w-full rounded-xl px-2.5 py-2 text-sm text-sl-ink placeholder:text-sl-ink3 focus:outline-none"
              style={{
                border: "1px solid rgba(244,232,218,0.10)",
                background: "rgba(244,232,218,0.04)",
                outline: "none",
              }}
              placeholder="(optional)"
              autoFocus={i === 0}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStart(value.trim(), [])}
            className="rounded-xl px-3 py-1.5 text-xs text-sl-ink3 transition hover:text-sl-ink2"
            style={{ border: "1px solid rgba(244,232,218,0.08)", background: "transparent", cursor: "pointer" }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmitClarifications}
            className="ml-auto rounded-xl px-3 py-1.5 text-xs font-semibold"
            style={{ background: "#8FC4EC", color: "#0d1117", border: 0, cursor: "pointer" }}
          >
            Start session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="no-drag flex flex-col gap-2.5">
      <button
        type="button"
        onClick={onBack}
        className="self-start font-mono text-[10px] text-sl-ink3 transition hover:text-sl-ink2"
        style={{ border: 0, background: "transparent", cursor: "pointer" }}
      >
        ← Change mode
      </button>
      <label className="font-mono text-[10px] uppercase tracking-widest text-sl-ink3">
        {copy.label}
      </label>
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
        className="sl-scroll w-full resize-none rounded-xl px-3 py-2.5 text-sm text-sl-ink placeholder:text-sl-ink3 focus:outline-none"
        style={{
          border: "1px solid rgba(244,232,218,0.10)",
          background: "rgba(244,232,218,0.04)",
          outline: "none",
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
          disabled={voice.state === "transcribing"}
          className="rounded-xl px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50"
          style={{
            border: "1px solid rgba(244,232,218,0.10)",
            background:
              voice.state === "recording"
                ? "rgba(239,68,68,0.12)"
                : "rgba(244,232,218,0.04)",
            color:
              voice.state === "recording" ? "#ef4444" : "#B8A89A",
            cursor: voice.state === "transcribing" ? "default" : "pointer",
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
          className="ml-auto rounded-xl px-4 py-1.5 text-xs font-semibold transition disabled:opacity-40"
          style={{ background: "#8FC4EC", color: "#0d1117", border: 0, cursor: "pointer" }}
        >
          {loadingClarify ? "…" : "Start session"}
        </button>
      </div>
      {voice.error && (
        <p className="text-[11px] text-sl-error">{voice.error}</p>
      )}
    </div>
  );
}
