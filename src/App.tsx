import { useCallback, useEffect, useState } from "react";
import { useSession } from "./store/session";
import { useSettings } from "./store/settings";
import { useSessionLoop } from "./hooks/useSessionLoop";
import { useRateLimitCountdown } from "./hooks/useRateLimitCountdown";
import { api } from "./lib/api";
import { Controls } from "./components/Controls";
import { FollowUpInput } from "./components/FollowUpInput";
import { GoalPrompt } from "./components/GoalPrompt";
import { Instruction } from "./components/Instruction";
import { IntervalSlider } from "./components/IntervalSlider";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { Settings as SettingsView } from "./components/Settings";
import { StatusIndicator } from "./components/StatusIndicator";
import { Thumbnail } from "./components/Thumbnail";
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

  const settings = useSettings((s) => s.settings);
  const keyStatus = useSettings((s) => s.keyStatus);
  const loadSettings = useSettings((s) => s.load);
  const patchSettings = useSettings((s) => s.patch);

  const [view, setView] = useState<View>("panel");
  const [focused, setFocused] = useState(false);

  const rateLimitCountdown = useRateLimitCountdown();

  const openSettings = useCallback(() => setView("settings"), []);
  useSessionLoop(openSettings);

  // Initial load + privacy gate.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!settings) return;
    if (!settings.hasSeenPrivacyNotice) {
      setView("privacy");
    }
  }, [settings]);

  // Window focus → opacity toggle: semi-transparent when not in focus.
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

  // Apply focus-based opacity to the OS window.
  useEffect(() => {
    if (!settings) return;
    const target = focused ? 1 : settings.opacity;
    void api().window.setOpacity(target);
  }, [focused, settings]);

  function startSession(g: string) {
    if (!keyStatus.anthropic) {
      setView("settings");
      return;
    }
    reset();
    setGoal(g);
    appendTurn({
      role: "user",
      content: `Goal: ${g}`,
      timestamp: Date.now(),
    });
    setStatus("watching");
  }

  function pause() {
    setStatus("paused");
  }
  function resume() {
    setStatus("watching");
  }
  function stop() {
    reset();
  }

  function submitFollowUp(text: string) {
    appendTurn({ role: "user", content: text, timestamp: Date.now() });
    // Trigger a fresh tick by toggling status back to watching.
    if (status === "paused" || status === "waiting" || status === "error") {
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

  // Main panel
  return (
    <PanelShell>
      <div className="flex h-full flex-col">
        <TitleBar onOpenSettings={openSettings} />
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 sl-scroll">
          {!goal ? (
            <GoalPrompt onStart={startSession} />
          ) : (
            <>
              <div className="flex items-start gap-2">
                <Thumbnail frame={lastFrame} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] uppercase tracking-wide text-neutral-500">
                    Goal
                  </p>
                  <p className="line-clamp-2 text-xs text-neutral-200">{goal}</p>
                </div>
              </div>
              <Instruction
                instruction={instruction}
                status={status}
                done={done}
                error={error}
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
                onPause={pause}
                onResume={resume}
                onStop={stop}
                onOpenSettings={openSettings}
              />
            </div>
            <FollowUpInput
              disabled={status === "thinking"}
              onSubmit={submitFollowUp}
            />
            {settings && (
              <IntervalSlider
                value={settings.captureIntervalSec}
                onChange={(v) => patchSettings({ captureIntervalSec: v })}
              />
            )}
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

function TitleBar({ onOpenSettings }: { onOpenSettings(): void }) {
  return (
    <div className="drag-region flex items-center gap-2 border-b border-panel-border px-3 py-1.5">
      <div className="h-2.5 w-2.5 rounded-sm bg-accent" />
      <span className="text-xs font-semibold tracking-wide text-neutral-100">
        SightLine
      </span>
      <span className="text-[10px] text-neutral-500">· always on top</span>
      <button
        onClick={onOpenSettings}
        className="no-drag ml-auto rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
