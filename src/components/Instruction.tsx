import { useEffect, useRef, useState } from "react";

interface Props {
  instruction: string;
  status: string;
  done: boolean;
  error: string | null;
  researchQuery?: string | null;
}

// Soft typewriter reveal — caps at ~140 chars so longer responses don't
// drag, and gracefully skips animation for unchanged text.
function useTypewriter(text: string): string {
  const [shown, setShown] = useState(text);
  const lastRef = useRef(text);

  useEffect(() => {
    if (text === lastRef.current) return;
    lastRef.current = text;
    if (!text) { setShown(""); return; }
    let i = 0;
    setShown("");
    const stepSize = Math.max(2, Math.ceil(text.length / 60));
    const id = window.setInterval(() => {
      i += stepSize;
      if (i >= text.length) {
        setShown(text);
        window.clearInterval(id);
      } else {
        setShown(text.slice(0, i));
      }
    }, 16);
    return () => window.clearInterval(id);
  }, [text]);

  return shown;
}

export function Instruction({ instruction, status, done, error, researchQuery }: Props) {
  const display = useTypewriter(instruction);

  if (error) {
    return (
      <div
        className="animate-fade-in rounded-xl border px-3 py-2.5 text-sm text-sl-error"
        style={{
          borderColor: "rgba(239,68,68,0.4)",
          background: "rgba(239,68,68,0.08)",
          borderLeft: "2px solid rgba(239,68,68,0.7)",
        }}
      >
        {error}
      </div>
    );
  }

  if (done) {
    return (
      <div
        className="sl-selectable animate-fade-in rounded-xl border px-3 py-2.5 text-sm leading-snug text-sl-ok"
        style={{
          borderColor: "rgba(91,208,139,0.35)",
          background: "rgba(91,208,139,0.08)",
        }}
      >
        <span
          className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ background: "rgba(91,208,139,0.2)", color: "#5BD08B" }}
        >
          ✓
        </span>
        {instruction || "Task complete."}
      </div>
    );
  }

  if (status === "researching") {
    return (
      <div
        className="rounded-xl border px-3 py-2.5 text-sm text-sl-thinking"
        style={{
          borderColor: "rgba(245,158,11,0.35)",
          background: "rgba(245,158,11,0.08)",
        }}
      >
        Looking something up…
        {researchQuery && (
          <span className="mt-0.5 block font-mono text-xs text-sl-ink3">
            "{researchQuery}"
          </span>
        )}
        <span className="mt-1 block text-xs text-sl-ink3">
          Resume when you have the info.
        </span>
      </div>
    );
  }

  if (status === "clarifying") {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-sl-ink2"
        style={{ borderColor: "rgba(244,232,218,0.08)", background: "rgba(244,232,218,0.04)" }}
      >
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-t-transparent spin-soft"
          style={{ borderColor: "#f59e0b", borderTopColor: "transparent" }}
        />
        Setting up your session…
      </div>
    );
  }

  if (status === "thinking" && !instruction) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-sl-ink2"
        style={{ borderColor: "rgba(244,232,218,0.08)", background: "rgba(244,232,218,0.04)" }}
      >
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-t-transparent spin-soft"
          style={{ borderColor: "#f59e0b", borderTopColor: "transparent" }}
        />
        Thinking…
      </div>
    );
  }

  if (!instruction) {
    return (
      <div
        className="rounded-xl border px-3 py-2.5 text-sm text-sl-ink3"
        style={{ borderColor: "rgba(244,232,218,0.06)", background: "rgba(244,232,218,0.02)" }}
      >
        Tell SightLine what you want to do, then start a session.
      </div>
    );
  }

  return (
    <div
      className="sl-selectable animate-fade-in rounded-xl border px-3 py-2.5 text-sm leading-snug text-sl-ink"
      style={{
        borderColor: "rgba(143,196,236,0.25)",
        background: "rgba(244,232,218,0.04)",
        borderLeft: "2px solid rgba(143,196,236,0.5)",
      }}
    >
      {display}
      {display.length < instruction.length && (
        <span
          className="ml-0.5 inline-block w-0.5 animate-pulse"
          style={{ background: "#8FC4EC", height: "0.9em", verticalAlign: "text-bottom" }}
        />
      )}
    </div>
  );
}
