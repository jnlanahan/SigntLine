import { useCallback, useEffect, useState } from "react";
import { useSession } from "./store/session";
import { useSettings } from "./store/settings";
import { useSessionLoop } from "./hooks/useSessionLoop";
import { useRateLimitCountdown } from "./hooks/useRateLimitCountdown";
import { useTts } from "./hooks/useTts";
import { api } from "./lib/api";
import { Controls } from "./components/Controls";
import { FollowUpInput } from "./components/FollowUpInput";
import { GoalPrompt } from "./components/GoalPrompt";
import type { Clarification } from "./components/GoalPrompt";
import { Instruction } from "./components/Instruction";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { Settings as SettingsView } from "./components/Settings";
import { StatusIndicator } from "./components/StatusIndicator";
import { CompletedSteps } from "./components/CompletedSteps";

type View = "panel" | "settings" | "privacy";

export default function App() {
  const status = useSession((s) => s.status);
  const goal = useSession((s) => s.goal);
  const instruction = useSession((s) => s.currentInstruction);
  const completedSteps = useSession((s) => s.completedSteps);
  const frames = useSession((s) => s.frames);
  const error = useSession((s) => s.lastError);
  const done = useSession((s) => s.done);
  const reset = useSession((s) => s.reset);
  const setStatus = useSession((s) => s.setStatus);
  const setGoal = useSession((s) => s.setGoal);
  const appendTurn = useSession((s) => s.appendTurn);
  const researchQuery = useSession((s) => s.researchQuery);

  const settings = useSettings((s) => s.settings);
  const keyStatus = useSettings((s) => s.keyStatus);
  const loadSettings = useSettings((s) => s.load);
  const patchSettings = useSettings((s) => s.patch);

  const [view, setView] = useState<View>("panel");
  const [focused, setFocused] = useState(false);
  const [showPeek, setShowPeek] = useState(false);

  const rateLimitCountdown = useRateLimitCountdown();
  const { cancel: cancelTts } = useTts();

  const openSettings = useCallback(() => setView("settings"), []);
  useSessionLoop(openSettings, focused);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settings) return;
    if (!settings.hasSeenPrivacyNotice) setView("privacy");
  }, [settings]);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    const target = focused ? 1 : settings.opacity;
    void api().window.setOpacity(target);
  }, [focused, settings]);

  // Dismiss peek overlay on Escape
  useEffect(() => {
    if (!showPeek) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowPeek(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPeek]);

  function startSession(g: string, clarifications: Clarification[] = []) {
    if (!keyStatus.anthropic) {
      setView("settings");
      return;
    }
    const ctx = clarifications
      .filter((c) => c.answer.trim())
      .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
      .join("\n\n");
    reset();
    if (ctx) useSession.getState().setClarificationContext(ctx);
    setGoal(g);
    appendTurn({ role: "user", content: `Goal: ${g}`, timestamp: Date.now() });
    setStatus("watching");
    void api().overlay.showGlow(settings?.selectedDisplayId ?? null);
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
    void api().overlay.hideGlow();
  }

  function submitFollowUp(text: string) {
    cancelTts();
    appendTurn({ role: "user", content: text, timestamp: Date.now() });
    useSession.getState().setPendingFollowUp(text);
    // A real follow-up should always trigger Claude on the next tick, even
    // mid-cooldown — the user just typed at us.
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
          onOpenSettings={openSettings}
          onPeek={() => setShowPeek((v) => !v)}
          hasPeek={Boolean(lastFrame)}
          showPeek={showPeek}
        />

        {/* Peek overlay */}
        {showPeek && lastFrame && (
          <div
            className="absolute inset-x-0 top-8 z-50 mx-2 overflow-hidden rounded-md border border-panel-border bg-black/90 shadow-xl"
            onClick={() => setShowPeek(false)}
          >
            <img
              src={lastFrame.dataUrl}
              alt="Current view"
              className="max-h-48 w-full object-contain"
            />
            <p className="px-2 py-1 text-center text-[9px] text-neutral-500">
              {new Date(lastFrame.timestamp).toLocaleTimeString()} · click to close
            </p>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 sl-scroll">
          {!goal ? (
            <GoalPrompt onStart={startSession} />
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">Goal</p>
                <p className="text-xs text-neutral-200">{goal}</p>
              </div>
              <Instruction
                instruction={instruction}
                status={status}
                done={done}
                error={error}
                researchQuery={researchQuery}
              />
              <CompletedSteps steps={completedSteps} />
            </>
          )}
        </div>

        {goal && (
          <div className="no-drag flex flex-col gap-2 border-t border-panel-border bg-black/20 p-2.5">
            <div className="flex items-center justify-between">
              <StatusIndicator
                status={status}
                rateLimitCountdown={rateLimitCountdown}
              />
              <Controls
                status={status}
                ttsEnabled={settings?.ttsEnabled ?? false}
                onPause={pause}
                onResume={resume}
                onStop={stop}
                onOpenSettings={openSettings}
                onToggleVoice={() => {
                  const nextEnabled = !settings?.ttsEnabled;
                  if (!nextEnabled) cancelTts();
                  void patchSettings({ ttsEnabled: nextEnabled });
                }}
              />
            </div>
            <FollowUpInput
              isThinking={status === "thinking"}
              onSubmit={submitFollowUp}
            />
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-panel-border bg-panel-bg shadow-2xl backdrop-blur-md">
      {children}
    </div>
  );
}

function TitleBar({
  onOpenSettings,
  onPeek,
  hasPeek,
  showPeek,
}: {
  onOpenSettings(): void;
  onPeek(): void;
  hasPeek: boolean;
  showPeek: boolean;
}) {
  return (
    <div className="drag-region flex items-center gap-2 border-b border-panel-border px-3 py-1.5">
      <div className="h-2.5 w-2.5 rounded-sm bg-accent" />
      <span className="text-xs font-semibold tracking-wide text-neutral-100">
        SightLine
      </span>
      {hasPeek && (
        <button
          type="button"
          onClick={onPeek}
          className={`no-drag ml-auto rounded px-1.5 py-0.5 text-[11px] transition ${
            showPeek
              ? "bg-white/10 text-neutral-100"
              : "text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
          }`}
          title="Peek at current view"
        >
          ⊡
        </button>
      )}
      <button
        type="button"
        onClick={onOpenSettings}
        className={`no-drag rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/10 hover:text-neutral-100 ${hasPeek ? "" : "ml-auto"}`}
        title="Settings"
      >
        ⚙
      </button>
      <button
        type="button"
        onClick={() => void api().app.quit()}
        className="no-drag rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-red-500/20 hover:text-red-400"
        title="Quit"
      >
        ✕
      </button>
    </div>
  );
}
