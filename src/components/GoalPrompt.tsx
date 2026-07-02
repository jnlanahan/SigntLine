import { useEffect, useRef, useState } from "react";
import { useVoice } from "../hooks/useVoice";
import { useTts } from "../hooks/useTts";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { useTheme } from "../design/ThemeProvider";
import { Eyebrow } from "../design/primitives";
import { ar, lt } from "../design/theme";
import { ScreenPicker } from "./ScreenPicker";
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
  const selectedDisplayId = useSettings((s) => s.settings?.selectedDisplayId ?? null);

  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<"input" | "clarifying" | "planning">("input");
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  // One question at a time (plan-mode style): which question is on screen,
  // and whether its free-text "Something else…" input is open.
  const [qIndex, setQIndex] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [loadingClarify, setLoadingClarify] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<SessionPlan | null>(null);

  const voice = useVoice((text) =>
    setValue((prev) => (prev ? `${prev} ${text}` : text)),
  );

  // Auto-start once the plan is ready — a human coach says "here's the plan"
  // and gets going; they don't wait for you to press a button. The overview
  // keeps playing through TTS; the plan steps stay visible in the session
  // view's plan rail. "Start now" remains for the impatient.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!plan || loadingPlan || startedRef.current) return;
    const hasContent = Boolean(plan.overview) || plan.steps.length > 0;
    const timer = window.setTimeout(
      () => {
        if (startedRef.current) return;
        startedRef.current = true;
        handleLetsGo();
      },
      hasContent ? 2_500 : 300,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, loadingPlan]);

  async function handleStart() {
    const t = value.trim();
    if (!t) return;
    setLoadingClarify(true);
    try {
      const result = await api().claude.getClarifications({ mode, goal: t });
      if ("questions" in result && result.questions.length > 0) {
        setQuestions(result.questions);
        setAnswers(new Array(result.questions.length).fill(""));
        setQIndex(0);
        setCustomOpen(false);
        setCustomText("");
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
    // Grab a snapshot of the screen so the planner can see what the user
    // actually has open. Best-effort — a capture failure just means no image.
    let screenshot: string | undefined;
    try {
      const frame = await api().capture.once(selectedDisplayId);
      screenshot = frame.dataUrl;
    } catch {
      // no screenshot — plan from text only
    }
    try {
      const result = await api().claude.getSessionPlan({ mode, goal, clarifications, screenshot });
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

  function handleLetsGo() {
    const clarifications: Clarification[] = questions.map((q, i) => ({
      question: q.question,
      answer: answers[i] ?? "",
    }));
    onStart(value.trim(), clarifications, plan?.steps ?? []);
  }

  // Record the answer for the current question and advance — the last answer
  // rolls straight into plan generation.
  function answerCurrent(answer: string) {
    const next = [...answers];
    next[qIndex] = answer;
    setAnswers(next);
    setCustomOpen(false);
    setCustomText("");
    if (qIndex + 1 < questions.length) {
      setQIndex(qIndex + 1);
    } else {
      const clarifications: Clarification[] = questions.map((q, i) => ({
        question: q.question,
        answer: next[i] ?? "",
      }));
      void fetchPlan(value.trim(), clarifications);
    }
  }

  // Skip the remaining questions; keep whatever was already answered.
  function skipRest() {
    const clarifications: Clarification[] = questions.map((q, i) => ({
      question: q.question,
      answer: answers[i] ?? "",
    }));
    void fetchPlan(value.trim(), clarifications);
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
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <span style={{ fontSize: 11.5, color: T.ink3 }}>
                Starting automatically…
              </span>
              <button
                type="button"
                onClick={() => {
                  startedRef.current = true;
                  handleLetsGo();
                }}
                style={{
                  marginLeft: "auto", borderRadius: 9, border: 0,
                  background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
                  color: T.onAccent,
                  fontSize: 13, fontWeight: 600, padding: "9px 22px",
                  cursor: "pointer",
                  boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
                }}
              >
                Start now →
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Clarifying phase — one question at a time, click to advance ────────────
  if (phase === "clarifying") {
    const q = questions[qIndex];
    if (!q) {
      // Defensive: no question at this index — go straight to the plan.
      skipRest();
      return null;
    }
    const optionBtn = (opt: string, recommended: boolean): React.CSSProperties => ({
      width: "100%", textAlign: "left" as const,
      borderRadius: 11, padding: "10px 14px",
      fontSize: 13, cursor: "pointer", transition: "all 140ms",
      border: recommended
        ? `1.5px solid ${ar(T.accentRGB, 0.6)}`
        : `1px solid ${lt(0.1)}`,
      background: recommended ? ar(T.accentRGB, 0.08) : lt(0.03),
      color: T.ink,
      display: "flex", alignItems: "center", gap: 8,
    });

    return (
      <div key={qIndex} className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Eyebrow>
          Question {qIndex + 1} of {questions.length}
        </Eyebrow>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.ink }}>
          {q.question}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {q.options.map((opt, i) => (
            <button
              key={opt}
              type="button"
              onClick={() => answerCurrent(opt)}
              style={optionBtn(opt, i < 2)}
            >
              <span style={{
                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                border: `1.5px solid ${i < 2 ? T.accentDeep : lt(0.25)}`,
                display: "grid", placeItems: "center",
                fontSize: 9, color: T.ink3,
              }}>
                {i + 1}
              </span>
              <span style={{ flex: 1 }}>{opt}</span>
              {i === 0 && (
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: T.accentText }}>
                  RECOMMENDED
                </span>
              )}
            </button>
          ))}

          {/* Something else — free text */}
          {!customOpen ? (
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              style={{ ...optionBtn("", false), color: T.ink2 }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                border: `1.5px solid ${lt(0.25)}`,
                display: "grid", placeItems: "center", fontSize: 11, color: T.ink3,
              }}>
                ✎
              </span>
              Something else…
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customText.trim()) answerCurrent(customText.trim());
                }}
                autoFocus
                placeholder="Type your answer…"
                className="no-drag"
                style={{ ...inputStyle, flex: 1, fontSize: 12.5, padding: "9px 12px" }}
              />
              <button
                type="button"
                disabled={!customText.trim()}
                onClick={() => answerCurrent(customText.trim())}
                style={{
                  borderRadius: 9, border: 0,
                  background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
                  color: T.onAccent, fontSize: 12, fontWeight: 600,
                  padding: "0 16px", cursor: "pointer",
                  opacity: customText.trim() ? 1 : 0.4,
                }}
              >
                Continue →
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={skipRest}
          style={{
            alignSelf: "flex-start", border: 0, background: "transparent",
            fontSize: 11.5, color: T.ink3, cursor: "pointer", padding: "2px 0",
          }}
        >
          Skip the rest — just build the plan
        </button>
      </div>
    );
  }

  // ── Input phase ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

      {/* Multi-monitor: pick the watched screen right here, in the flow —
          most users never open Settings. Renders nothing on single-screen. */}
      <ScreenPicker compact />

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
