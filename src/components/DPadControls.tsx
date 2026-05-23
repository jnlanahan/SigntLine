import { CSSProperties, useState } from "react";
import type { SessionStatus } from "../lib/api";

const PAD_W  = 380;   // panel width
const SIZE   = 116;   // D-pad cross footprint
const ARM_W  = 40;    // arm (pill) thickness
const HALF   = SIZE / 2;
const CORE_R = 20;    // lava core radius
const HIT    = 32;    // arm icon hit-zone

const PILL_BG =
  "radial-gradient(ellipse at 50% 0%, #0f1a26 0%, #04080f 80%)";
const PILL_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -2px 8px rgba(0,0,0,0.55), 0 0 0 1px rgba(244,232,218,0.06), 0 10px 26px rgba(0,0,0,0.45)";

interface Props {
  status: SessionStatus;
  ttsEnabled: boolean;
  stepsCount: number;
  showSteps: boolean;
  showFollowUp: boolean;
  hasPeek: boolean;
  showPeek: boolean;
  attachedCount: number;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onToggleSteps(): void;
  onToggleFollowUp(): void;
  onToggleVoice(): void;
  onAttach(): void;
  onPeek(): void;
  rateLimitCountdown: number | null;
}

export function DPadControls(props: Props) {
  const {
    status, ttsEnabled, stepsCount, showSteps, showFollowUp,
    hasPeek, showPeek, attachedCount,
    onPause, onResume, onStop, onToggleSteps, onToggleFollowUp,
    onToggleVoice, onAttach, onPeek, rateLimitCountdown,
  } = props;

  const [centerDown, setCenterDown] = useState(false);
  const [hoverArm, setHoverArm]     = useState<string | null>(null);
  const [hoverPeek, setHoverPeek]   = useState(false);
  const [hoverStop, setHoverStop]   = useState(false);

  const running   = status === "watching" || status === "thinking";
  const resumable = status === "paused" || status === "researching";
  const canAct    = running || resumable;

  function handleCenter() {
    if (running)   onPause();
    else if (resumable) onResume();
  }

  // Horizontal offset so the cross is centered in the 380px panel
  const padLeft = PAD_W / 2 - SIZE / 2;

  return (
    <div
      className="no-drag relative flex-shrink-0 border-t"
      style={{
        height: 120,
        borderTopColor: "rgba(244,232,218,0.08)",
        background: "rgba(10,15,26,0.60)",
      }}
    >
      {/* Ambient ground bloom */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 85%, rgba(90,147,199,0.22) 0%, rgba(90,147,199,0.08) 45%, transparent 75%)",
          filter: "blur(20px)",
          animation: "dpad-bloom 5.5s ease-in-out infinite",
        }}
      />

      {/* ── Centered D-pad cross ── */}
      <div
        className="absolute"
        style={{ left: padLeft, top: 2, width: SIZE, height: SIZE }}
      >
        {/* Horizontal pill */}
        <div
          className="absolute rounded-full"
          style={{
            left: 0, right: 0,
            top: HALF - ARM_W / 2, height: ARM_W,
            background: PILL_BG,
            boxShadow: PILL_SHADOW,
          }}
        />
        {/* Vertical pill */}
        <div
          className="absolute rounded-full"
          style={{
            top: 0, bottom: 0,
            left: HALF - ARM_W / 2, width: ARM_W,
            background: PILL_BG,
            boxShadow: PILL_SHADOW,
          }}
        />

        {/* Specular highlights */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: HALF - ARM_W / 2 + 1, left: 10, right: 10, height: 1,
            background:
              "linear-gradient(to right, transparent, rgba(255,255,255,0.14), transparent)",
          }}
        />
        <div
          className="pointer-events-none absolute"
          style={{
            left: HALF - ARM_W / 2 + 1, top: 10, bottom: 10, width: 1,
            background:
              "linear-gradient(to bottom, transparent, rgba(255,255,255,0.10), transparent)",
          }}
        />

        {/* Arm highlight overlays on hover/active */}
        <ArmGlow dir="up"    hoverArm={hoverArm} showSteps={showSteps} />
        <ArmGlow dir="down"  hoverArm={hoverArm} showFollowUp={showFollowUp} />
        <ArmGlow dir="left"  hoverArm={hoverArm} ttsEnabled={ttsEnabled} />
        <ArmGlow dir="right" hoverArm={hoverArm} attachedCount={attachedCount} />

        {/* ── Lava core ── */}
        {/* Outer breathing halo */}
        <div
          className="pointer-events-none absolute"
          style={{
            left: HALF, top: HALF,
            width: 76, height: 76,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(143,196,236,0.38) 0%, rgba(90,147,199,0.18) 35%, transparent 75%)",
            filter: "blur(12px)",
            animation: "dpad-core-pulse 4.2s ease-in-out infinite",
            transform: "translate(-50%, -50%)",
          }}
        />

        {/* Core vent button */}
        <button
          type="button"
          onPointerDown={() => setCenterDown(true)}
          onPointerUp={() => setCenterDown(false)}
          onPointerLeave={() => setCenterDown(false)}
          onClick={handleCenter}
          title={running ? "Pause" : resumable ? "Resume" : ""}
          style={{
            position: "absolute",
            left: HALF - CORE_R, top: HALF - CORE_R,
            width: CORE_R * 2, height: CORE_R * 2,
            borderRadius: "50%",
            overflow: "hidden",
            cursor: canAct ? "pointer" : "default",
            border: 0,
            transform: centerDown ? "scale(0.93)" : "scale(1)",
            transition: "transform 220ms cubic-bezier(0.3,0,0.2,1)",
            background:
              "radial-gradient(circle at 50% 70%, rgba(143,196,236,0.87) 0%, rgba(90,147,199,0.53) 22%, #0f1a26 55%, #04080f 88%)",
            boxShadow:
              "inset 0 0 0 1px rgba(0,0,0,0.65), inset 0 -4px 10px rgba(0,0,0,0.55), inset 0 2px 4px rgba(255,255,255,0.06), 0 0 0 1px rgba(143,196,236,0.2), 0 0 16px 1px rgba(143,196,236,0.4), 0 0 40px 8px rgba(90,147,199,0.2)",
            zIndex: 4,
          }}
        >
          {/* Lava blob 1 */}
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              width: 28, height: 28, left: "12%", top: "42%",
              background:
                "radial-gradient(circle, rgba(143,196,236,0.93) 0%, rgba(90,147,199,0.47) 45%, transparent 80%)",
              filter: "blur(5px)",
              animation: "dpad-blob1 5s ease-in-out infinite",
            }}
          />
          {/* Lava blob 2 */}
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              width: 22, height: 22, right: "10%", top: "12%",
              background:
                "radial-gradient(circle, rgba(143,196,236,0.80) 0%, rgba(90,147,199,0.33) 50%, transparent 80%)",
              filter: "blur(4px)",
              animation: "dpad-blob2 5s ease-in-out infinite",
            }}
          />
          {/* Specular highlight */}
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              top: 4, left: 7,
              width: 11, height: 6,
              background:
                "radial-gradient(ellipse, rgba(255,255,255,0.55) 0%, transparent 70%)",
            }}
          />
          {/* Status icon */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ zIndex: 5 }}
          >
            {running   && <PauseIcon />}
            {resumable && <PlayIcon />}
          </div>
        </button>

        {/* Press pulse ring */}
        {centerDown && (
          <div
            className="dpad-pulse-ring pointer-events-none absolute rounded-full"
            style={{
              left: HALF, top: HALF,
              width: CORE_R * 2, height: CORE_R * 2,
              border: "2px solid #8FC4EC",
              opacity: 0.5,
            }}
          />
        )}

        {/* ── Arm buttons ── */}
        <ArmButton
          dir="up" active={showSteps} hover={hoverArm === "up"}
          onEnter={() => setHoverArm("up")} onLeave={() => setHoverArm(null)}
          onClick={onToggleSteps} label="Steps"
          badge={stepsCount > 0 ? String(stepsCount) : undefined}
        >
          <StepsIcon active={showSteps} />
        </ArmButton>

        <ArmButton
          dir="down" active={showFollowUp} hover={hoverArm === "down"}
          onEnter={() => setHoverArm("down")} onLeave={() => setHoverArm(null)}
          onClick={onToggleFollowUp} label="Ask"
        >
          <ChatIcon active={showFollowUp} />
        </ArmButton>

        <ArmButton
          dir="left" active={ttsEnabled} hover={hoverArm === "left"}
          onEnter={() => setHoverArm("left")} onLeave={() => setHoverArm(null)}
          onClick={onToggleVoice} label={ttsEnabled ? "Voice on" : "Voice off"}
        >
          <VoiceIcon on={ttsEnabled} />
        </ArmButton>

        <ArmButton
          dir="right" active={attachedCount > 0} hover={hoverArm === "right"}
          onEnter={() => setHoverArm("right")} onLeave={() => setHoverArm(null)}
          onClick={onAttach} label="Attach"
          badge={attachedCount > 0 ? String(attachedCount) : undefined}
        >
          <AttachIcon active={attachedCount > 0} />
        </ArmButton>
      </div>

      {/* ── Corner: Peek (left of cross) ── */}
      <button
        type="button"
        onClick={onPeek}
        onMouseEnter={() => setHoverPeek(true)}
        onMouseLeave={() => setHoverPeek(false)}
        title="Peek at current view"
        className="absolute flex flex-col items-center gap-0.5"
        style={{
          left: padLeft - 48,
          top: HALF - 20,
          opacity: hasPeek ? 1 : 0.3,
          border: 0,
          background: "transparent",
          cursor: hasPeek ? "pointer" : "default",
          color: showPeek ? "#8FC4EC" : hoverPeek && hasPeek ? "#B8A89A" : "#7A6E63",
          transition: "color 160ms",
        }}
      >
        <EyeIcon active={showPeek} />
        <span style={{ fontSize: 8, fontFamily: "ui-monospace, monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Peek
        </span>
      </button>

      {/* ── Corner: Stop (right of cross) ── */}
      <button
        type="button"
        onClick={onStop}
        onMouseEnter={() => setHoverStop(true)}
        onMouseLeave={() => setHoverStop(false)}
        title="Stop session"
        className="absolute flex flex-col items-center gap-0.5"
        style={{
          left: padLeft + SIZE + 8,
          top: HALF - 20,
          border: 0,
          background: "transparent",
          cursor: "pointer",
          color: hoverStop ? "#ef4444" : "#7A6E63",
          transition: "color 160ms",
        }}
      >
        <StopSquareIcon />
        <span style={{ fontSize: 8, fontFamily: "ui-monospace, monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Stop
        </span>
      </button>

      {/* ── Rate-limit countdown ── */}
      {rateLimitCountdown !== null && rateLimitCountdown > 0 && (
        <div
          className="absolute bottom-1 left-0 right-0 text-center"
          style={{ fontFamily: "ui-monospace, monospace", fontSize: 9, color: "#f59e0b" }}
        >
          retry in {rateLimitCountdown}s
        </div>
      )}
    </div>
  );
}

/* ── Arm glow overlay on the chassis ── */
function ArmGlow({
  dir, hoverArm, showSteps, showFollowUp, ttsEnabled, attachedCount,
}: {
  dir: "up" | "down" | "left" | "right";
  hoverArm: string | null;
  showSteps?: boolean;
  showFollowUp?: boolean;
  ttsEnabled?: boolean;
  attachedCount?: number;
}) {
  const isActive =
    (dir === "up"    && showSteps)   ||
    (dir === "down"  && showFollowUp) ||
    (dir === "left"  && ttsEnabled)  ||
    (dir === "right" && (attachedCount ?? 0) > 0);
  const isHover = hoverArm === dir && !isActive;
  if (!isActive && !isHover) return null;

  const base: CSSProperties = {
    position: "absolute",
    borderRadius: 999,
    mixBlendMode: "screen",
    opacity: isActive ? 1 : 0.45,
    pointerEvents: "none",
    transition: "opacity 220ms",
    filter: "blur(2px)",
    background: isActive
      ? "radial-gradient(circle, rgba(143,196,236,0.33) 0%, transparent 70%)"
      : "radial-gradient(circle, rgba(143,196,236,0.18) 0%, transparent 70%)",
  };
  const arms: Record<string, CSSProperties> = {
    up:    { left: HALF - ARM_W / 2, top: 0,            width: ARM_W, height: HALF - 4 },
    down:  { left: HALF - ARM_W / 2, top: HALF + 4,     width: ARM_W, height: HALF - 4 },
    left:  { top: HALF - ARM_W / 2,  left: 0,           width: HALF - 4, height: ARM_W },
    right: { top: HALF - ARM_W / 2,  left: HALF + 4,    width: HALF - 4, height: ARM_W },
  };
  return <div style={{ ...base, ...arms[dir] }} />;
}

/* ── Arm button (icon + hover label) ── */
function ArmButton({
  dir, active, hover, onEnter, onLeave, onClick, label, badge, children,
}: {
  dir: "up" | "down" | "left" | "right";
  active: boolean;
  hover: boolean;
  onEnter(): void;
  onLeave(): void;
  onClick(): void;
  label: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const margin = 5;
  const pos: CSSProperties = {};
  if (dir === "up")    Object.assign(pos, { left: HALF - HIT / 2, top: margin });
  if (dir === "down")  Object.assign(pos, { left: HALF - HIT / 2, top: SIZE - HIT - margin });
  if (dir === "left")  Object.assign(pos, { left: margin,          top: HALF - HIT / 2 });
  if (dir === "right") Object.assign(pos, { left: SIZE - HIT - margin, top: HALF - HIT / 2 });

  return (
    <>
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
        title={label}
        style={{
          position: "absolute",
          ...pos,
          width: HIT, height: HIT,
          border: 0, background: "transparent",
          cursor: "pointer",
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          zIndex: 3,
          transform: active ? "scale(0.92)" : "scale(1)",
          transition: "transform 140ms",
        }}
      >
        {/* Icon halo on hover/active */}
        {(hover || active) && (
          <span
            style={{
              position: "absolute", inset: 4,
              borderRadius: "50%",
              background: active
                ? "radial-gradient(circle, rgba(143,196,236,0.4) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(143,196,236,0.2) 0%, transparent 70%)",
              filter: "blur(3px)",
              pointerEvents: "none",
            }}
          />
        )}
        {children}
        {badge && (
          <span
            style={{
              position: "absolute", right: -1, top: -1,
              minWidth: 14, height: 14,
              borderRadius: 999,
              background: "#8FC4EC",
              color: "#0d1117",
              fontSize: 7,
              fontWeight: 700,
              fontFamily: "ui-monospace, monospace",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 2px",
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {/* Hover label pill */}
      {hover && !active && (
        <ArmLabel dir={dir} label={label} />
      )}
    </>
  );
}

function ArmLabel({ dir, label }: { dir: string; label: string }) {
  const base: CSSProperties = {
    position: "absolute",
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(13,17,23,0.95)",
    color: "#B8A89A",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
    border: "1px solid rgba(244,232,218,0.08)",
    boxShadow: "0 6px 16px rgba(0,0,0,0.5)",
    pointerEvents: "none",
    zIndex: 6,
    animation: "dpad-label-in 180ms cubic-bezier(0.2,0,0.1,1) both",
  };
  if (dir === "up")    return <div style={{ ...base, left: "50%", bottom: SIZE + 4, transform: "translateX(-50%)" }}>{label}</div>;
  if (dir === "down")  return <div style={{ ...base, left: "50%", top: SIZE + 4,    transform: "translateX(-50%)" }}>{label}</div>;
  if (dir === "left")  return <div style={{ ...base, right: SIZE + 4, top: "50%",   transform: "translateY(-50%)" }}>{label}</div>;
  if (dir === "right") return <div style={{ ...base, left: SIZE + 4,  top: "50%",   transform: "translateY(-50%)" }}>{label}</div>;
  return null;
}

/* ── Inline SVG icons ── */
const INK  = "#B8A89A";
const INK3 = "#7A6E63";
const ACC  = "#8FC4EC";

function PauseIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
      <rect x="1" y="1" width="3" height="10" rx="1" fill="rgba(244,232,218,0.8)" />
      <rect x="6" y="1" width="3" height="10" rx="1" fill="rgba(244,232,218,0.8)" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
      <path d="M1 1.5l9 5-9 5z" fill="rgba(244,232,218,0.8)" strokeLinejoin="round" />
    </svg>
  );
}
function StopsquareIc() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}
function StopSquareIcon() {
  return <StopsquareIc />;
}

function EyeIcon({ active }: { active: boolean }) {
  const c = active ? ACC : INK3;
  return (
    <svg width="16" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4S1 7 1 7z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1.8" fill={c} />
    </svg>
  );
}

function StepsIcon({ active }: { active: boolean }) {
  const c = active ? ACC : INK;
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d="M2 4.2l1.6 1.6 3-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M2 9l1.6 1.6 3-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="3.6" cy="14.4" r="1.1" fill={c} />
      <path d="M9 4h7M9 9h7M9 14h5" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon({ active }: { active: boolean }) {
  const c = active ? ACC : INK;
  return (
    <svg width="15" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3.5h10v6H6.5L4 11.5v-2H2v-6z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function VoiceIcon({ on }: { on: boolean }) {
  if (on) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill={ACC} fillOpacity="0.2" stroke={ACC} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.5 4.5c1 .8 1 4.2 0 5M11 3c1.6 1.4 1.6 6.6 0 8" stroke={ACC} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill="none" stroke={INK3} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 5l3.5 4M12.5 5L9 9" stroke={INK3} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function AttachIcon({ active }: { active: boolean }) {
  const c = active ? ACC : INK;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M11.5 6.5l-5 5a3.5 3.5 0 01-4.95-4.95l5.5-5.5A2.33 2.33 0 0110.35 4.3L5 9.64a1.17 1.17 0 01-1.65-1.65l4.5-4.49"
        stroke={c}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
