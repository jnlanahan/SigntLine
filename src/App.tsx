import { useCallback, useEffect, useState } from "react";
import { useSession } from "./store/session";
import { useSettings } from "./store/settings";
import { useSessionLoop } from "./hooks/useSessionLoop";
import { useRateLimitCountdown } from "./hooks/useRateLimitCountdown";
import { useTts } from "./hooks/useTts";
import { api } from "./lib/api";
import { FollowUpInput } from "./components/FollowUpInput";
import { GoalPrompt } from "./components/GoalPrompt";
import { ModeSelect } from "./components/ModeSelect";
import type { AppMode, Clarification, SessionStatus } from "./lib/api";
import { Instruction } from "./components/Instruction";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { Settings as SettingsView } from "./components/Settings";
import { CompletedSteps } from "./components/CompletedSteps";
import { ConversationHistory } from "./components/ConversationHistory";
import { useTheme } from "./design/ThemeProvider";
import { Glow, Logo, Spinner, CtrlBtn } from "./design/primitives";
import { IMic, IPause, IGear, IExpand } from "./design/icons";
import { ar, lt } from "./design/theme";

type View = "panel" | "settings" | "privacy";

const MODE_LABELS: Record<AppMode, string> = {
  tech_support: "Tech Support",
  training:     "Training",
  teacher:      "Teacher",
};

const MODE_META: Record<AppMode, { goalLabel: string; stepNoun: string }> = {
  tech_support: { goalLabel: "Goal", stepNoun: "step" },
  training:     { goalLabel: "Training plan for", stepNoun: "plan step" },
  teacher:      { goalLabel: "Learning", stepNoun: "topic" },
};

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle:        "Ready when you are",
  watching:    "AI: WATCHING",
  thinking:    "AI: THINKING",
  waiting:     "Done",
  paused:      "Paused",
  error:       "Error",
  clarifying:  "Setting up…",
  researching: "Researching…",
};

const STATUS_DOT: Record<SessionStatus, string> = {
  idle:        "#79808D",
  watching:    "#8FCB66",
  thinking:    "#f59e0b",
  waiting:     "#8FCB66",
  paused:      "#79808D",
  error:       "#ef4444",
  clarifying:  "#f59e0b",
  researching: "#f59e0b",
};

export default function App() {
  const status         = useSession((s) => s.status);
  const mode           = useSession((s) => s.mode);
  const goal           = useSession((s) => s.goal);
  const instruction    = useSession((s) => s.currentInstruction);
  const completedSteps = useSession((s) => s.completedSteps);
  const upcomingSteps  = useSession((s) => s.upcomingSteps);
  const frames         = useSession((s) => s.frames);
  const error          = useSession((s) => s.lastError);
  const done           = useSession((s) => s.done);
  const reset          = useSession((s) => s.reset);
  const setStatus      = useSession((s) => s.setStatus);
  const setMode        = useSession((s) => s.setMode);
  const setGoal        = useSession((s) => s.setGoal);
  const appendTurn     = useSession((s) => s.appendTurn);
  const researchQuery  = useSession((s) => s.researchQuery);
  const conversation   = useSession((s) => s.conversation);
  const attachedFileNames = useSession((s) => s.attachedFileNames);
  const agentNotes     = useSession((s) => s.agentNotes);

  const settings      = useSettings((s) => s.settings);
  const keyStatus     = useSettings((s) => s.keyStatus);
  const loadSettings  = useSettings((s) => s.load);
  const patchSettings = useSettings((s) => s.patch);

  const [view, setView]                   = useState<View>("panel");
  const [focused, setFocused]             = useState(false);
  const [showPeek, setShowPeek]           = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const rateLimitCountdown = useRateLimitCountdown();
  const { cancel: cancelTts } = useTts();

  const openSettings = useCallback(() => setView("settings"), []);
  useSessionLoop(openSettings, focused);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  useEffect(() => {
    return api().overlay.onRegionUpdated(() => { void loadSettings(); });
  }, [loadSettings]);

  useEffect(() => {
    if (!settings) return;
    if (!settings.hasSeenPrivacyNotice) setView("privacy");
  }, [settings]);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur  = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur",  onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur",  onBlur);
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const target = focused ? 1 : settings.opacity;
    void api().window.setOpacity(target);
  }, [focused, settings]);

  useEffect(() => {
    if (!showPeek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowPeek(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPeek]);

  function startSession(g: string, clarifications: Clarification[] = [], planSteps: string[] = []) {
    if (!keyStatus.anthropic) { setView("settings"); return; }
    const ctx = clarifications
      .filter((c) => c.answer.trim())
      .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
      .join("\n\n");
    const activeMode = useSession.getState().mode;
    reset();
    if (activeMode) setMode(activeMode);
    if (ctx) useSession.getState().setClarificationContext(ctx);
    if (planSteps.length > 0) useSession.getState().setUpcomingSteps(planSteps);
    setGoal(g);
    appendTurn({ role: "user", content: `Goal: ${g}`, timestamp: Date.now() });
    setStatus("watching");
  }

  function pause() {
    cancelTts();
    useSession.getState().setPauseReason("user");
    setStatus("paused");
  }
  function resume() {
    useSession.getState().setPauseReason(null);
    useSession.getState().resetIdleCycles();
    useSession.getState().setResearchQuery(null);
    useSession.getState().setCooldownUntil(null);
    setStatus("watching");
  }
  function stop() {
    cancelTts();
    reset();
    setShowPeek(false);
    setShowStopConfirm(false);
  }

  function submitFollowUp(text: string) {
    cancelTts();
    appendTurn({ role: "user", content: text, timestamp: Date.now() });
    useSession.getState().setPendingFollowUp(text);
    useSession.getState().setCooldownUntil(null);
    if (status === "thinking") return;
    if (
      status === "paused" ||
      status === "waiting" ||
      status === "error" ||
      status === "researching"
    ) {
      useSession.getState().setPauseReason(null);
      useSession.getState().setResearchQuery(null);
      setStatus("watching");
    }
  }

  async function attachContext() {
    const files = await api().files.pickContext();
    if (files.length > 0) useSession.getState().addUploadedContext(files);
  }

  function toggleVoice() {
    const next = !settings?.ttsEnabled;
    if (!next) cancelTts();
    void patchSettings({ ttsEnabled: next });
  }

  const lastFrame  = frames.length > 0 ? frames[frames.length - 1] : null;
  const showSpinner = status === "thinking" || status === "researching" || status === "clarifying";

  if (view === "privacy") {
    return (
      <PanelShell>
        <PrivacyNotice
          onAccept={async () => {
            await patchSettings({ hasSeenPrivacyNotice: true });
            setView("panel");
          }}
        />
      </PanelShell>
    );
  }

  if (view === "settings") {
    return (
      <PanelShell>
        <SettingsView onClose={() => setView("panel")} />
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <PanelHeader
        status={status}
        mode={mode}
        showSpinner={showSpinner}
        ttsEnabled={settings?.ttsEnabled ?? false}
        onToggleVoice={toggleVoice}
        onOpenSettings={openSettings}
        onAdjustCapture={() => { void api().overlay.setAdjust(true); }}
        onQuit={() => void api().app.quit()}
      />

      {/* Peek overlay */}
      {showPeek && lastFrame && (
        <div
          className="absolute inset-x-0 z-50 mx-2 cursor-pointer overflow-hidden rounded-xl border border-sl-divider bg-sl-bg shadow-xl"
          style={{ top: 72 }}
          onClick={() => setShowPeek(false)}
        >
          <img
            src={lastFrame.dataUrl}
            alt="Current view"
            className="max-h-48 w-full object-contain"
          />
          <p className="px-2 py-1 text-center font-mono text-[9px] text-sl-ink3">
            {new Date(lastFrame.timestamp).toLocaleTimeString()} · click to close
          </p>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 pt-2 sl-scroll">
        {!mode ? (
          <ModeSelect onSelect={setMode} onSettings={openSettings} />
        ) : !goal ? (
          <GoalPrompt mode={mode} onStart={startSession} onBack={() => { reset(); }} />
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <p className="font-mono text-[9px] uppercase tracking-widest text-sl-ink3">
                {MODE_META[mode].goalLabel}
              </p>
              <p className="text-xs leading-snug text-sl-ink2">{goal}</p>
            </div>
            <ContextPanel
              fileNames={attachedFileNames}
              notes={agentNotes}
              onAttach={attachContext}
            />
            <Instruction
              instruction={instruction}
              status={status}
              done={done}
              error={error}
              researchQuery={researchQuery}
            />
            <CompletedSteps
              completedSteps={completedSteps}
              currentInstruction={instruction}
              upcomingSteps={upcomingSteps}
              noun={MODE_META[mode].stepNoun}
            />
            <ConversationHistory turns={conversation} />
            <FollowUpInput
              isThinking={status === "thinking"}
              mode={mode}
              onSubmit={submitFollowUp}
            />
          </>
        )}
      </div>

      {/* Control bar */}
      {goal && (
        <>
          {showStopConfirm && (
            <StopConfirmBanner
              onConfirm={stop}
              onCancel={() => setShowStopConfirm(false)}
            />
          )}
          <ControlBar
            status={status}
            ttsEnabled={settings?.ttsEnabled ?? false}
            hasPeek={Boolean(lastFrame)}
            showPeek={showPeek}
            attachedCount={attachedFileNames.length}
            rateLimitCountdown={rateLimitCountdown}
            onPause={pause}
            onResume={resume}
            onStop={() => setShowStopConfirm(true)}
            onToggleVoice={toggleVoice}
            onAttach={attachContext}
            onPeek={() => setShowPeek((v) => !v)}
          />
        </>
      )}
    </PanelShell>
  );
}

/* ── Panel shell — full-window glass container ── */

function PanelShell({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        borderRadius: 22,
        overflow: "hidden",
        // backdropFilter must NOT be on this element — it breaks -webkit-app-region: drag on Windows/Chromium
        fontFamily: T.font,
        color: T.ink,
      }}
    >
      {/* Glass layer — absolutely positioned behind content so the outer container stays drag-compatible */}
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backdropFilter: "blur(26px) saturate(1.35)",
        WebkitBackdropFilter: "blur(26px) saturate(1.35)",
        background: `${T.glassGrad}, ${T.glassBg}`,
        border: `1px solid ${T.border}`,
        boxShadow: `0 1px 0 0 ${T.hi} inset, 0 30px 70px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.3)`,
        borderRadius: 22,
      }} />
      <Glow />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        {children}
      </div>
    </div>
  );
}

/* ── Integrated panel header ── */

function PanelHeader({
  status,
  mode,
  showSpinner,
  ttsEnabled,
  onToggleVoice,
  onOpenSettings,
  onAdjustCapture,
  onQuit,
}: {
  status: SessionStatus;
  mode: AppMode | null;
  showSpinner: boolean;
  ttsEnabled: boolean;
  onToggleVoice(): void;
  onOpenSettings(): void;
  onAdjustCapture(): void;
  onQuit(): void;
}) {
  const T = useTheme();
  const dotColor = STATUS_DOT[status];
  const pulses   = status === "watching" || status === "thinking";

  return (
    <div
      className="drag-region"
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "13px 16px 11px",
        borderBottom: `1px solid ${lt(0.08)}`,
        flexShrink: 0,
      }}
    >
      <Logo size={38} radius={11} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.1, color: T.ink }}>
          SightLine
        </div>
        <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.ink3 }}>
          {/* Status dot */}
          <span style={{ position: "relative", display: "inline-flex", width: 7, height: 7, flexShrink: 0 }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: dotColor }} />
            {pulses && (
              <span style={{
                position: "absolute", inset: -3, borderRadius: "50%",
                background: dotColor, opacity: 0.3,
                animation: "sl-live-pulse 1.5s ease-out infinite",
              }} />
            )}
          </span>
          <span>{STATUS_TEXT[status]}</span>
          {mode && (
            <span style={{ color: T.ink3 }}>
              ·&nbsp;<span style={{ color: T.accent }}>{MODE_LABELS[mode]}</span>
            </span>
          )}
        </div>
      </div>

      {showSpinner && <Spinner size={24} />}

      <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <CtrlBtn title={ttsEnabled ? "Voice on" : "Voice off"} onClick={onToggleVoice}>
          {ttsEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
        </CtrlBtn>
        <CtrlBtn title="Adjust capture area" onClick={onAdjustCapture}>
          <CropIcon />
        </CtrlBtn>
        <CtrlBtn title="Settings" onClick={onOpenSettings}>
          <IGear />
        </CtrlBtn>
        <CtrlBtn title="Quit" onClick={onQuit} color="#ef4444">
          <CloseIcon />
        </CtrlBtn>
      </div>
    </div>
  );
}

/* ── Control bar — flat icon row replacing the D-pad ── */

function ControlBar({
  status,
  ttsEnabled,
  hasPeek,
  showPeek,
  attachedCount,
  rateLimitCountdown,
  onPause,
  onResume,
  onStop,
  onToggleVoice,
  onAttach,
  onPeek,
}: {
  status: SessionStatus;
  ttsEnabled: boolean;
  hasPeek: boolean;
  showPeek: boolean;
  attachedCount: number;
  rateLimitCountdown: number | null;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onToggleVoice(): void;
  onAttach(): void;
  onPeek(): void;
}) {
  const T   = useTheme();
  const isPaused = status === "paused";

  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "center", gap: 2,
        padding: "10px 12px 12px",
        borderTop: `1px solid ${lt(0.07)}`,
        flexShrink: 0,
      }}
    >
      <CtrlBtn
        title={ttsEnabled ? "Voice on — click to mute" : "Voice off — click to enable"}
        onClick={onToggleVoice}
        color={ttsEnabled ? T.accent : undefined}
      >
        <IMic c={ttsEnabled ? T.accent : "currentColor"} />
      </CtrlBtn>

      <CtrlBtn
        title={attachedCount > 0 ? `${attachedCount} file(s) attached — attach more` : "Attach file"}
        onClick={onAttach}
        color={attachedCount > 0 ? T.ink : undefined}
      >
        <AttachIcon />
      </CtrlBtn>

      {hasPeek && (
        <CtrlBtn
          title="Peek at last screenshot"
          onClick={onPeek}
          color={showPeek ? T.accent : undefined}
        >
          <IExpand c={showPeek ? T.accent : "currentColor"} />
        </CtrlBtn>
      )}

      {/* Pause / Resume — accent gradient, primary action */}
      <button
        className="no-drag"
        onClick={isPaused ? onResume : onPause}
        title={isPaused ? "Resume" : "Pause"}
        style={{
          width: 36, height: 36, border: 0, borderRadius: 11, cursor: "pointer",
          background: `linear-gradient(180deg, ${T.accent}, ${T.accentDeep})`,
          color: T.onAccent,
          display: "grid", placeItems: "center",
          boxShadow: `0 4px 12px -4px ${ar(T.accentRGB, 0.7)}`,
          flexShrink: 0,
          transition: "opacity 150ms",
          marginLeft: 4,
        }}
      >
        {isPaused ? <PlayIcon c={T.onAccent} /> : <IPause c={T.onAccent} />}
      </button>

      <div style={{ flex: 1 }} />

      {/* Rate limit countdown */}
      {rateLimitCountdown != null && rateLimitCountdown > 0 && (
        <span style={{ fontSize: 10, color: T.ink3, fontVariantNumeric: "tabular-nums", marginRight: 4 }}>
          {rateLimitCountdown}s
        </span>
      )}

      {/* Live status pill */}
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
        color: T.accent, padding: "5px 10px", borderRadius: 999,
        background: ar(T.accentRGB, 0.1), border: `1px solid ${ar(T.accentRGB, 0.22)}`,
        flexShrink: 0,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: T.accent,
          boxShadow: `0 0 8px ${T.accent}`, animation: "sl-blink 1.6s ease-in-out infinite",
        }} />
        AI LIVE
      </span>

      {/* Stop */}
      <CtrlBtn title="Stop session" onClick={onStop} color="#ef4444">
        <StopIcon />
      </CtrlBtn>
    </div>
  );
}

/* ── Stop confirmation banner ── */

function StopConfirmBanner({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const T = useTheme();
  return (
    <div
      className="no-drag"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px",
        borderTop: `1px solid ${lt(0.07)}`,
        background: "rgba(239,68,68,0.07)",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, color: T.ink2, flex: 1 }}>
        End session? Your progress will be cleared.
      </span>
      <button
        type="button"
        onClick={onCancel}
        style={{
          borderRadius: 8, border: `1px solid ${lt(0.12)}`,
          background: "transparent", color: T.ink2,
          fontSize: 11, padding: "5px 12px", cursor: "pointer",
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        style={{
          borderRadius: 8, border: 0,
          background: "#ef4444", color: "#fff",
          fontSize: 11, fontWeight: 600, padding: "5px 12px", cursor: "pointer",
        }}
      >
        End session
      </button>
    </div>
  );
}

/* ── Context panel (files + agent notes) ── */

function ContextPanel({
  fileNames,
  notes,
  onAttach,
}: {
  fileNames: string[];
  notes: string[];
  onAttach(): void;
}) {
  const T = useTheme();
  const [notesOpen, setNotesOpen] = useState(false);
  const hasContent = fileNames.length > 0 || notes.length > 0;

  if (!hasContent) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink3 }}>
          Context
        </span>
        <button
          type="button"
          onClick={onAttach}
          className="no-drag"
          title="Attach text or markdown files"
          style={{
            borderRadius: 8, border: `1px solid ${lt(0.08)}`,
            background: lt(0.04), padding: "3px 10px",
            fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
            cursor: "pointer", transition: "background 150ms",
          }}
        >
          + Attach file
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink3 }}>
          Context
        </span>
        <button
          type="button"
          onClick={onAttach}
          className="no-drag"
          style={{
            borderRadius: 8, border: `1px solid ${lt(0.08)}`,
            background: lt(0.04), padding: "3px 10px",
            fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
            cursor: "pointer",
          }}
        >
          + Attach
        </button>
      </div>
      {fileNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {fileNames.map((name, i) => (
            <span
              key={i}
              title={name}
              style={{
                borderRadius: 6, border: `1px solid ${lt(0.08)}`,
                background: lt(0.04), padding: "2px 8px",
                fontFamily: "ui-monospace, monospace", fontSize: 10, color: T.ink2,
              }}
            >
              {name}
            </span>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            style={{
              fontFamily: "ui-monospace, monospace", fontSize: 9,
              textTransform: "uppercase", letterSpacing: "0.1em",
              color: T.ink3, background: "transparent", border: 0, cursor: "pointer",
              transition: "color 150ms",
            }}
          >
            {notesOpen ? "▼" : "▶"} Notes ({notes.length})
          </button>
          {notesOpen && (
            <ul className="sl-selectable sl-scroll" style={{
              marginTop: 6, display: "flex", flexDirection: "column", gap: 4,
              maxHeight: 128, overflowY: "auto", paddingRight: 2,
            }}>
              {notes.map((note, i) => (
                <li
                  key={i}
                  style={{
                    borderRadius: 8, background: ar("194,232,75", 0.06),
                    padding: "6px 10px", fontSize: 11, lineHeight: 1.4, color: T.ink2,
                  }}
                >
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Local SVG icons (not in the design icon set) ── */

function SpeakerOnIcon() {
  const T = useTheme();
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill={T.accent} fillOpacity="0.25" stroke={T.accent} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.5 4.5c1 .8 1 4.2 0 5M11 3c1.6 1.4 1.6 6.6 0 8" stroke={T.accent} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function SpeakerOffIcon() {
  const T = useTheme();
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill="none" stroke={T.ink3} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 5l3.5 4M12.5 5L9 9" stroke={T.ink3} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CropIcon() {
  const T = useTheme();
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 1.5v9h9" stroke={T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 3h9v9" stroke={T.ink2} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2.5 1.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13 7.5l-5.5 5.5a4 4 0 0 1-5.66-5.66l5.5-5.5a2.5 2.5 0 0 1 3.54 3.54L5.37 10.9a1 1 0 0 1-1.41-1.41L9.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon({ c }: { c?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3.5l8 4.5-8 4.5V3.5Z" fill={c || "currentColor"} />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}
