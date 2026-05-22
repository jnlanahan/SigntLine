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

const PROMPT_COPY: Record<
  AppMode,
  { label: string; placeholder: string }
> = {
  tech_support: {
    label: "What do you want help with?",
    placeholder:
      'e.g. "Help me set up S3 storage in AWS" or "Walk me through partitioning my hard drive"',
  },
  training: {
    label: "What do you want to build a training plan for?",
    placeholder:
      'e.g. "Onboarding new support reps" or "How our team files expense reports"',
  },
  teacher: {
    label: "What do you want to learn?",
    placeholder:
      'e.g. "This machine-learning paper" or "Chapter 4 of my statistics textbook"',
  },
};

export function GoalPrompt({ mode, onStart, onBack }: Props) {
  const copy = PROMPT_COPY[mode];
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<"input" | "clarifying">("input");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
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
        <p className="text-[11px] uppercase tracking-wide text-neutral-400">
          A few quick questions to get started
        </p>
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-1">
            <label className="text-xs text-neutral-300">{q}</label>
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
                    const nextInput = document.querySelectorAll<HTMLInputElement>(
                      ".clarify-input",
                    )[i + 1];
                    nextInput?.focus();
                  }
                }
              }}
              className="clarify-input no-drag rounded-md border border-panel-border bg-black/30 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-accent focus:outline-none"
              placeholder="(optional)"
              autoFocus={i === 0}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStart(value.trim(), [])}
            className="rounded-md border border-panel-border px-3 py-1.5 text-xs text-neutral-400 hover:bg-black/40"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmitClarifications}
            className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white"
          >
            Start session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="no-drag flex flex-col gap-2">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-[11px] text-neutral-500 hover:text-neutral-300"
      >
        ← Change mode
      </button>
      <label className="text-[11px] uppercase tracking-wide text-neutral-400">
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
        className="sl-scroll w-full resize-none rounded-md border border-panel-border bg-black/30 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-accent focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
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
          type="button"
          onClick={() => void handleStart()}
          disabled={value.trim().length === 0 || loadingClarify}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {loadingClarify ? "…" : "Start session"}
        </button>
      </div>
      {voice.error && (
        <p className="text-[11px] text-error">{voice.error}</p>
      )}
    </div>
  );
}
