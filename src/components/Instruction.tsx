import { useEffect, useRef, useState } from "react";
import { useTheme } from "../design/ThemeProvider";
import { lt } from "../design/theme";

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
  const T = useTheme();
  const display = useTypewriter(instruction);

  if (error) {
    return (
      <div
        className="animate-fade-in"
        style={{
          borderRadius: 13, padding: "12px 14px", fontSize: 13.5,
          color: "#ef4444",
          border: `1px solid rgba(239,68,68,0.35)`,
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
        className="sl-selectable animate-fade-in"
        style={{
          borderRadius: 13, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.5,
          color: "#3D6E20",
          border: `1px solid rgba(110,167,66,0.45)`,
          background: "rgba(110,167,66,0.12)",
        }}
      >
        <span
          style={{
            display: "inline-flex", width: 16, height: 16,
            alignItems: "center", justifyContent: "center",
            borderRadius: "50%", marginRight: 8,
            background: "rgba(110,167,66,0.25)", color: "#3D6E20",
            fontSize: 10, fontWeight: 700, verticalAlign: "middle",
          }}
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
        style={{
          borderRadius: 13, padding: "12px 14px", fontSize: 13.5,
          color: "#f59e0b",
          border: `1px solid rgba(245,158,11,0.35)`,
          background: "rgba(245,158,11,0.08)",
        }}
      >
        Looking something up…
        {researchQuery && (
          <span style={{ display: "block", marginTop: 3, fontFamily: "ui-monospace, monospace", fontSize: 11, color: T.ink3 }}>
            "{researchQuery}"
          </span>
        )}
        <span style={{ display: "block", marginTop: 4, fontSize: 12, color: T.ink3 }}>
          Resume when you have the info.
        </span>
      </div>
    );
  }

  if (status === "clarifying") {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          borderRadius: 13, padding: "12px 14px", fontSize: 13.5, color: T.ink2,
          border: `1px solid ${lt(0.08)}`, background: lt(0.04),
        }}
      >
        <span
          className="spin-soft"
          style={{
            display: "inline-block", width: 13, height: 13, borderRadius: "50%",
            border: "2px solid #f59e0b", borderTopColor: "transparent", flexShrink: 0,
          }}
        />
        Setting up your session…
      </div>
    );
  }

  if (status === "thinking" && !instruction) {
    return (
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          borderRadius: 13, padding: "12px 14px", fontSize: 13.5, color: T.ink2,
          border: `1px solid ${lt(0.08)}`, background: lt(0.04),
        }}
      >
        <span
          className="spin-soft"
          style={{
            display: "inline-block", width: 13, height: 13, borderRadius: "50%",
            border: "2px solid #f59e0b", borderTopColor: "transparent", flexShrink: 0,
          }}
        />
        Thinking…
      </div>
    );
  }

  if (!instruction) {
    return (
      <div
        style={{
          borderRadius: 13, padding: "12px 14px", fontSize: 13.5, color: T.ink3,
          border: `1px solid ${lt(0.06)}`, background: lt(0.02),
        }}
      >
        Taking a look at your screen — your first step is coming up.
      </div>
    );
  }

  // The voice card: the coach's spoken words are the one dark object on the
  // light panel — deep ink, serif, always the first thing your eye lands on.
  return (
    <div
      style={{
        borderRadius: 13,
        background: T.instr,
        border: `1px solid rgba(0,0,0,0.25)`,
        boxShadow: "0 12px 30px -12px rgba(22,26,14,0.55)",
        padding: "13px 15px",
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.13em",
        textTransform: "uppercase", color: "rgba(240,238,228,0.5)",
      }}>
        Current step
      </div>
      <div
        className="sl-selectable animate-fade-in"
        style={{
          marginTop: 8, fontFamily: T.display, fontSize: 15.5,
          lineHeight: 1.55, color: "#F4F1E8",
        }}
      >
        {display}
        {display.length < instruction.length && (
          <span
            style={{
              display: "inline-block", width: 2, marginLeft: 2,
              background: T.accent, height: "0.9em",
              verticalAlign: "text-bottom",
              animation: "sl-blink 1.6s ease-in-out infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}
