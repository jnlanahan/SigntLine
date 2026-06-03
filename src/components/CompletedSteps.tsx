import { useState } from "react";
import { useTheme } from "../design/ThemeProvider";
import { ar, lt } from "../design/theme";

interface Props {
  completedSteps: string[];
  currentInstruction: string;
  upcomingSteps: string[];
  noun?: string;
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 200ms" }}
    >
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function CompletedSteps({ completedSteps, currentInstruction, upcomingSteps, noun = "step" }: Props) {
  const T = useTheme();
  const [open, setOpen] = useState(true);

  const hasContent = completedSteps.length > 0 || upcomingSteps.length > 0 || currentInstruction;
  if (!hasContent) return null;

  const totalDone = completedSteps.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", padding: "4px 0",
          cursor: "pointer", color: T.ink3, width: "100%", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>
          Plan
        </span>
        {totalDone > 0 && (
          <span style={{ fontSize: 10, color: T.ink3, fontVariantNumeric: "tabular-nums" }}>
            · {totalDone} {noun}{totalDone === 1 ? "" : "s"} done
          </span>
        )}
        <span style={{ marginLeft: "auto", color: T.ink3 }}>
          <ChevronIcon open={open} />
        </span>
      </button>

      {/* Step list */}
      {open && (
        <ol className="sl-scroll" style={{
          display: "flex", flexDirection: "column", gap: 5,
          maxHeight: 220, overflowY: "auto", paddingRight: 2,
          margin: "6px 0 0 0", padding: 0, listStyle: "none",
        }}>
          {/* Completed steps */}
          {completedSteps.map((s, i) => (
            <li key={`done-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                background: "rgba(34,197,94,0.15)", color: "#22c55e",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginTop: 1,
              }}>
                <CheckIcon />
              </span>
              <span style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4, textDecoration: "line-through", opacity: 0.6 }}>
                {s}
              </span>
            </li>
          ))}

          {/* Current / in-progress step */}
          {currentInstruction && (
            <li style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                border: `2px solid ${T.accent}`,
                background: ar(T.accentRGB, 0.12),
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginTop: 1,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent }} />
              </span>
              <span style={{ fontSize: 12, color: T.ink, lineHeight: 1.4, fontWeight: 500 }}>
                {currentInstruction.length > 80
                  ? currentInstruction.slice(0, 80) + "…"
                  : currentInstruction}
              </span>
            </li>
          )}

          {/* Upcoming steps */}
          {upcomingSteps.map((s, i) => (
            <li key={`up-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                border: `1.5px solid ${lt(0.18)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, marginTop: 1,
              }} />
              <span style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4, opacity: 0.7 }}>
                {s}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
