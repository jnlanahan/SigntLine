import { useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { useTts } from "../hooks/useTts";
import { api } from "../lib/api";
import { useTheme } from "../design/ThemeProvider";
import { Eyebrow } from "../design/primitives";
import { ar, lt } from "../design/theme";
import type { AppMode, Clarification, ClarificationQuestion, SessionPlan } from "../lib/api";

interface Props {
  mode: AppMode;
  onStart(goal: string, clarifications: Clarification[], planSteps: string[]): void;
  onBack(): void;
}

const PROMPT_COPY: Record<AppMode, { label: string; placeholder: string }> = {
  tech_support: {
    label:       "What do you want help with?",
    placeholder: 'e.g. "Help me set up S3 storage in AWS" or "Walk me through partitioning my hard drive"',
  },
  training: {
    label:       "What workflow do you want to document as a training plan?",
    placeholder: 'e.g. "How to onboard a new support rep" — I\'ll watch you do it on screen and build the plan as you go',
  },
  teacher: {
    label:       "What do you want to learn?",
    placeholder: 'e.g. "This machine-learning paper" or "Chapter 4 of my statistics textbook"',
  },
};

export function GoalPrompt({ mode, onStart, onBack }: Props) {
  const T = useTheme();
  const copy = PROMPT_COPY[mode];
  const { speak } = useTts();

  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<"input" | "clarifying" | "planning">("input");
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [customInputVisible, setCustomInputVisible] = useState<boolean[]>([]);
  const [loadingClarify, setLoadingClarify] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<SessionPlan | null>(null);

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
        setCustomInputVisible(new Array(result.questions.length).fill(false));
        setPhase("clarifying");
        return;
      }
    } catch {
      // fail-safe: skip clarification
    } finally {
      setLoadingClarify(false);
    }
    // No questions — go straight to plan
    await fetchPlan(t, []);
  }

  async function fetchPlan(goal: string, clarifications: Clarification[]) {
    setLoadingPlan(true);
    setPhase("planning");
    try {
      const result = await api().claude.getSessionPlan({ mode, goal, clarifications });
      if ("overview" in result) {
        setPlan(result);
        if (result.overview) speak(result.overview);
      }
    } catch {
      // fail-safe: start without plan
      setPlan({ overview: "", steps: [] });
    } finally {
      setLoadingPlan(false);
    }
  }

  async function handleSubmitClarifications() {
    const clarifications: Clarification[] = questions.map((q, i) => ({
      question: q.question,
      answer: answers[i] ?? "",
    }));
    await fetchPlan(value.trim(), clarifications);
  }

  function handleLetsGo() {
    const clarifications: Clarification[] = questions.map((q, i) => ({
      question: q.question,
      answer: answers[i] ?? "",
    }));
    onStart(value.trim(), clarifications, plan?.steps ?? []);
  }

  function selectOption(qIdx: number, option: string) {
    const next = [...answers];
    next[qIdx] = option;
    setAnswers(next);
    // Hide custom input when a chip option is selected
    const nextVisible = [...customInputVisible];
    nextVisible[qIdx] = false;
    setCustomInputVisible(nextVisible);
  }

  function showCustomInput(qIdx: number) {
    const nextVisible = [...customInputVisible];
    nextVisible[qIdx] = true;
    setCustomInputVisible(nextVisible);
    // Clear chip selection so custom input is the active answer
    const next = [...answers];
    next[qIdx] = "";
    setAnswers(next);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", border: `1px solid ${lt(0.10)}`,
    background: lt(0.04), borderRadius: 11,
    padding: "9px 12px", fontSize: 13.5, color: T.ink,
    outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  };

  // ── Planning phase ──────────────────────────────────────────────────────────
  if (phase === "planning") {
    return (
      <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Eyebrow>
          {loadingPlan ? "Building your plan…" : "Here's the plan"}
        </Eyebrow>

        {loadingPlan && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.ink3, fontSize: 12.5 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Talking to your guide…
          </div>
        )}

        {!loadingPlan && plan && (
          <>
            {plan.overview && (
              <p style={{ fontSize: 13, color: T.ink2, margin: 0, lineHeight: 1.5 }}>
                {plan.overview}
              </p>
            )}
            {plan.steps.length > 0 && (
              <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {plan.steps.map((step, i) => (
                  <li key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: "50%",
                      border: `1.5px solid ${lt(0.2)}`,
                      flexShrink: 0, fontSize: 10, color: T.ink3,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 13, color: T.ink2 }}>{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {plan.steps.length === 0 && !loadingPlan && (
              <p style={{ fontSize: 12.5, color: T.ink3, margin: 0 }}>
                Starting session…
              </p>
            )}
            <button
              type="button"
              onClick={handleLetsGo}
              style={{
                marginTop: 4, borderRadius: 9, border: 0,
                background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
                color: T.onAccent,
                fontSize: 13, fontWeight: 600, padding: "9px 22px",
                cursor: "pointer", alignSelf: "flex-end",
                boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
              }}
            >
              Let's go →
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Clarifying phase ────────────────────────────────────────────────────────
  if (phase === "clarifying") {
    return (
      <div className="no-drag" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Eyebrow>A few quick questions to get started</Eyebrow>
        {questions.map((q, i) => {
          const recommended = q.options.slice(0, 2);
          const additional = q.options.slice(2);
          const selected = answers[i] ?? "";
          const isCustom = customInputVisible[i];

          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12.5, color: T.ink2, fontWeight: 500 }}>{q.question}</label>

              {/* Recommended chips */}
              {recommended.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {recommended.map((opt) => {
                    const active = selected === opt && !isCustom;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => selectOption(i, opt)}
                        style={{
                          borderRadius: 20, padding: "6px 12px",
                          fontSize: 12, cursor: "pointer", transition: "all 150ms",
                          border: `1.5px solid ${active ? T.accent : ar(T.accentRGB, 0.4)}`,
                          background: active ? `${ar(T.accentRGB, 0.15)}` : "transparent",
                          color: active ? T.accent : T.ink2,
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Additional / alternative chips */}
              {additional.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {additional.map((opt) => {
                    const active = selected === opt && !isCustom;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => selectOption(i, opt)}
                        style={{
                          borderRadius: 20, padding: "5px 11px",
                          fontSize: 11.5, cursor: "pointer", transition: "all 150ms",
                          border: `1px solid ${active ? T.ink2 : lt(0.12)}`,
                          background: active ? lt(0.08) : "transparent",
                          color: active ? T.ink : T.ink3,
                        }}
                      >
                        {opt}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => showCustomInput(i)}
                    style={{
                      borderRadius: 20, padding: "5px 11px",
                      fontSize: 11.5, cursor: "pointer", transition: "all 150ms",
                      border: `1px solid ${isCustom ? T.ink2 : lt(0.12)}`,
                      background: isCustom ? lt(0.08) : "transparent",
                      color: isCustom ? T.ink : T.ink3,
                    }}
                  >
                    Custom…
                  </button>
                </div>
              )}

              {/* No additional options: always show Custom chip */}
              {additional.length === 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => showCustomInput(i)}
                    style={{
                      borderRadius: 20, padding: "5px 11px",
                      fontSize: 11.5, cursor: "pointer", transition: "all 150ms",
                      border: `1px solid ${isCustom ? T.ink2 : lt(0.12)}`,
                      background: isCustom ? lt(0.08) : "transparent",
                      color: isCustom ? T.ink : T.ink3,
                    }}
                  >
                    Custom…
                  </button>
                </div>
              )}

              {/* Custom text input (visible when Custom chip is active) */}
              {isCustom && (
                <input
                  type="text"
                  value={selected}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = e.target.value;
                    setAnswers(next);
                  }}
                  autoFocus
                  placeholder="Type your answer…"
                  className="no-drag"
                  style={{ ...inputStyle, fontSize: 12.5, padding: "7px 11px" }}
                />
              )}
            </div>
          );
        })}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <button
            type="button"
            onClick={() => void fetchPlan(value.trim(), [])}
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
            onClick={() => void handleSubmitClarifications()}
            style={{
              marginLeft: "auto", borderRadius: 9, border: 0,
              background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
              color: T.onAccent,
              fontSize: 12, fontWeight: 600, padding: "7px 18px",
              cursor: "pointer",
              boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
            }}
          >
            Next →
          </button>
        </div>
      </div>
    );
  }

  // ── Input phase ─────────────────────────────────────────────────────────────
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
