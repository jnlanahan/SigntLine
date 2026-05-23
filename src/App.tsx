import { useCallback, useEffect, useState } from "react";
import { useSession } from "./store/session";
import { useSettings } from "./store/settings";
import { useSessionLoop } from "./hooks/useSessionLoop";
import { useRateLimitCountdown } from "./hooks/useRateLimitCountdown";
import { useTts } from "./hooks/useTts";
import { api } from "./lib/api";
import { DPadControls } from "./components/DPadControls";
import { FollowUpInput } from "./components/FollowUpInput";
import { GoalPrompt } from "./components/GoalPrompt";
import type { Clarification } from "./components/GoalPrompt";
import { ModeSelect } from "./components/ModeSelect";
import type { AppMode, SessionStatus } from "./lib/api";
import { Instruction } from "./components/Instruction";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { Settings as SettingsView } from "./components/Settings";
import { CompletedSteps } from "./components/CompletedSteps";
import { ConversationHistory } from "./components/ConversationHistory";

type View = "panel" | "settings" | "privacy";

const MODE_META: Record<AppMode, { goalLabel: string; stepNoun: string }> = {
  tech_support: { goalLabel: "Goal", stepNoun: "step" },
  training:     { goalLabel: "Training plan for", stepNoun: "plan step" },
  teacher:      { goalLabel: "Learning", stepNoun: "topic" },
};

const STATUS_TEXT: Record<SessionStatus, string> = {
  idle:        "ready",
  watching:    "watching · live",
  thinking:    "thinking",
  waiting:     "done",
  paused:      "paused",
  error:       "error",
  clarifying:  "setting up",
  researching: "researching",
};

const STATUS_DOT: Record<SessionStatus, string> = {
  idle:        "#7A6E63",
  watching:    "#5BD08B",
  thinking:    "#f59e0b",
  waiting:     "#5BD08B",
  paused:      "#7A6E63",
  error:       "#ef4444",
  clarifying:  "#f59e0b",
  researching: "#f59e0b",
};

export default function App() {
  const status        = useSession((s) => s.status);
  const mode          = useSession((s) => s.mode);
  const goal          = useSession((s) => s.goal);
  const instruction   = useSession((s) => s.currentInstruction);
  const completedSteps= useSession((s) => s.completedSteps);
  const frames        = useSession((s) => s.frames);
  const error         = useSession((s) => s.lastError);
  const done          = useSession((s) => s.done);
  const reset         = useSession((s) => s.reset);
  const setStatus     = useSession((s) => s.setStatus);
  const setMode       = useSession((s) => s.setMode);
  const setGoal       = useSession((s) => s.setGoal);
  const appendTurn    = useSession((s) => s.appendTurn);
  const researchQuery = useSession((s) => s.researchQuery);
  const conversation  = useSession((s) => s.conversation);
  const attachedFileNames = useSession((s) => s.attachedFileNames);
  const agentNotes    = useSession((s) => s.agentNotes);

  const settings         = useSettings((s) => s.settings);
  const keyStatus        = useSettings((s) => s.keyStatus);
  const loadSettings     = useSettings((s) => s.load);
  const patchSettings    = useSettings((s) => s.patch);

  const [view, setView]             = useState<View>("panel");
  const [focused, setFocused]       = useState(false);
  const [showPeek, setShowPeek]     = useState(false);
  const [showSteps, setShowSteps]   = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

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

  function startSession(g: string, clarifications: Clarification[] = []) {
    if (!keyStatus.anthropic) { setView("settings"); return; }
    const ctx = clarifications
      .filter((c) => c.answer.trim())
      .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
      .join("\n\n");
    const activeMode = useSession.getState().mode;
    reset();
    if (activeMode) setMode(activeMode);
    if (ctx) useSession.getState().setClarificationContext(ctx);
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
    setShowSteps(false);
    setShowFollowUp(false);
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

  const lastFrame = frames.length > 0 ? frames[frames.length - 1] : null;

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
      <div className="relative flex h-full flex-col">
        <TitleBar
          status={status}
          ttsEnabled={settings?.ttsEnabled ?? false}
          onToggleVoice={toggleVoice}
          onOpenSettings={openSettings}
          onAdjustCapture={() => { void api().overlay.setAdjust(true); }}
        />

        {/* Peek overlay */}
        {showPeek && lastFrame && (
          <div
            className="absolute inset-x-0 top-10 z-50 mx-2 cursor-pointer overflow-hidden rounded-xl border border-sl-divider bg-sl-bg shadow-xl"
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

        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 sl-scroll">
          {!mode ? (
            <ModeSelect onSelect={setMode} />
          ) : !goal ? (
            <GoalPrompt mode={mode} onStart={startSession} onBack={() => setMode(null)} />
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
              {showSteps && (
                <CompletedSteps
                  steps={completedSteps}
                  noun={MODE_META[mode].stepNoun}
                />
              )}
              <ConversationHistory turns={conversation} />
              {showFollowUp && (
                <FollowUpInput
                  isThinking={status === "thinking"}
                  mode={mode}
                  onSubmit={submitFollowUp}
                />
              )}
            </>
          )}
        </div>

        {goal && (
          <DPadControls
            status={status}
            ttsEnabled={settings?.ttsEnabled ?? false}
            stepsCount={completedSteps.length}
            showSteps={showSteps}
            showFollowUp={showFollowUp}
            hasPeek={Boolean(lastFrame)}
            showPeek={showPeek}
            attachedCount={attachedFileNames.length}
            onPause={pause}
            onResume={resume}
            onStop={stop}
            onToggleSteps={() => setShowSteps((v) => !v)}
            onToggleFollowUp={() => setShowFollowUp((v) => !v)}
            onToggleVoice={toggleVoice}
            onAttach={attachContext}
            onPeek={() => setShowPeek((v) => !v)}
            rateLimitCountdown={rateLimitCountdown}
          />
        )}
      </div>
    </PanelShell>
  );
}

function ContextPanel({
  fileNames,
  notes,
  onAttach,
}: {
  fileNames: string[];
  notes: string[];
  onAttach(): void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const hasContent = fileNames.length > 0 || notes.length > 0;
  if (!hasContent && fileNames.length === 0 && notes.length === 0) {
    return (
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-widest text-sl-ink3">Context</p>
        <button
          type="button"
          onClick={onAttach}
          className="no-drag rounded-lg border border-sl-divider bg-sl-chipBg px-2 py-0.5 font-mono text-[10px] text-sl-ink2 transition hover:border-sl-dividerStrong hover:bg-sl-iconHover"
          title="Attach text or markdown files"
        >
          + Attach file
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-widest text-sl-ink3">Context</p>
        <button
          type="button"
          onClick={onAttach}
          className="no-drag rounded-lg border border-sl-divider bg-sl-chipBg px-2 py-0.5 font-mono text-[10px] text-sl-ink2 transition hover:border-sl-dividerStrong hover:bg-sl-iconHover"
          title="Attach text or markdown files"
        >
          + Attach
        </button>
      </div>
      {fileNames.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fileNames.map((name, i) => (
            <span
              key={i}
              className="rounded-md border border-sl-divider bg-sl-chipBg px-1.5 py-0.5 font-mono text-[10px] text-sl-ink2"
              title={name}
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
            className="font-mono text-[9px] uppercase tracking-widest text-sl-ink3 hover:text-sl-ink2 transition"
          >
            {notesOpen ? "▼" : "▶"} Notes ({notes.length})
          </button>
          {notesOpen && (
            <ul className="sl-selectable mt-1.5 flex max-h-32 flex-col gap-1 overflow-y-auto sl-scroll pr-0.5">
              {notes.map((note, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-sl-accentSoft px-2 py-1.5 text-[11px] leading-snug text-sl-ink2"
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

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden rounded-[18px] bg-sl-bg"
      style={{
        boxShadow:
          "0 0 0 1px rgba(244,232,218,0.06), 0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Ambient lava layer — always behind content, never receives pointer events */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[18px]">
        {/* Top-right lava blob */}
        <div
          className="absolute rounded-full"
          style={{
            width: 180, height: 180,
            right: "-15%", top: "-10%",
            background:
              "radial-gradient(circle, rgba(90,147,199,0.32) 0%, rgba(90,147,199,0.12) 40%, transparent 75%)",
            filter: "blur(24px)",
            animation: "sl-lava2 16s ease-in-out infinite",
          }}
        />
        {/* Bottom-left lava blob */}
        <div
          className="absolute rounded-full"
          style={{
            width: 220, height: 220,
            left: "-20%", top: "40%",
            background:
              "radial-gradient(circle, rgba(90,147,199,0.20) 0%, rgba(90,147,199,0.08) 40%, transparent 75%)",
            filter: "blur(28px)",
            animation: "sl-lava1 14s ease-in-out infinite",
          }}
        />
        {/* Window tint + specular highlight */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 30% 0%, #142233 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, rgba(90,147,199,0.06) 0%, transparent 55%)",
          }}
        />
        <div
          className="absolute left-3 right-3 top-0 h-px"
          style={{
            background:
              "linear-gradient(to right, transparent, rgba(255,255,255,0.18), transparent)",
          }}
        />
      </div>

      {/* Content sits above ambient layer */}
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  );
}

function TitleBar({
  status,
  ttsEnabled,
  onToggleVoice,
  onOpenSettings,
  onAdjustCapture,
}: {
  status: SessionStatus;
  ttsEnabled: boolean;
  onToggleVoice(): void;
  onOpenSettings(): void;
  onAdjustCapture(): void;
}) {
  const dotColor = STATUS_DOT[status];
  const pulses   = status === "watching" || status === "thinking";

  return (
    <div
      className="drag-region flex flex-shrink-0 items-center gap-2 border-b px-3 py-2.5"
      style={{
        background: "rgba(10,15,26,0.7)",
        borderBottomColor: "rgba(244,232,218,0.08)",
      }}
    >
      {/* Status dot with optional ping ring */}
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: dotColor }}
        />
        {pulses && (
          <span
            className="absolute rounded-full opacity-35"
            style={{
              inset: -3,
              background: dotColor,
              animation: "sl-live-pulse 1.5s ease-out infinite",
            }}
          />
        )}
      </span>

      <span className="text-[13px] font-semibold tracking-tight text-sl-ink">
        SightLine
      </span>
      <span className="font-mono text-[10px] text-sl-ink3">
        {STATUS_TEXT[status]}
      </span>

      {/* Icon buttons — right side */}
      <div className="no-drag ml-auto flex items-center gap-0.5">
        {/* Voice toggle */}
        <IconBtn onClick={onToggleVoice} title={ttsEnabled ? "Voice on" : "Voice off"}>
          {ttsEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
        </IconBtn>
        {/* Adjust capture area */}
        <IconBtn onClick={onAdjustCapture} title="Adjust capture area">
          <CropIcon />
        </IconBtn>
        {/* Settings */}
        <IconBtn onClick={onOpenSettings} title="Settings">
          <GearIcon />
        </IconBtn>
        {/* Quit */}
        <IconBtn onClick={() => void api().app.quit()} title="Quit" danger>
          <CloseIcon />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  onClick,
  title,
  danger,
  children,
}: {
  onClick(): void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      data-no-drag
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="no-drag flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent transition"
      style={{
        background: hover
          ? danger
            ? "rgba(239,68,68,0.15)"
            : "rgba(244,232,218,0.07)"
          : "transparent",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ── Header SVG icons ── */
function SpeakerOnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2 5v4h2l3 2.5v-9L4 5H2z"
        fill="#8FC4EC"
        fillOpacity="0.2"
        stroke="#8FC4EC"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 4.5c1 .8 1 4.2 0 5M11 3c1.6 1.4 1.6 6.6 0 8"
        stroke="#8FC4EC"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
function SpeakerOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2 5v4h2l3 2.5v-9L4 5H2z"
        fill="none"
        stroke="#7A6E63"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M9 5l3.5 4M12.5 5L9 9"
        stroke="#7A6E63"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="#B8A89A" strokeWidth="1.4" />
      <path
        d="M7 1.5v1.6M7 10.9v1.6M12.5 7h-1.6M3.1 7H1.5M10.9 3.1l-1.1 1.1M4.2 9.8l-1.1 1.1M10.9 10.9l-1.1-1.1M4.2 4.2L3.1 3.1"
        stroke="#B8A89A"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M2 2l6 6M8 2l-6 6"
        stroke="#7A6E63"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function CropIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 1.5v9h9" stroke="#B8A89A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 3h9v9" stroke="#B8A89A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2.5 1.5" />
    </svg>
  );
}
