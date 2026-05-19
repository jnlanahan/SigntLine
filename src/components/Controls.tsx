import type { SessionStatus } from "../lib/api";

interface Props {
  status: SessionStatus;
  ttsEnabled: boolean;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onOpenSettings(): void;
  onToggleVoice(): void;
}

export function Controls({
  status,
  ttsEnabled,
  onPause,
  onResume,
  onStop,
  onOpenSettings,
  onToggleVoice,
}: Props) {
  const running = status === "watching" || status === "thinking";
  const resumable = status === "paused" || status === "researching";
  const researchLabel = status === "researching" ? "▶ Done Researching" : "▶ Resume";

  return (
    <div className="no-drag flex items-center gap-1.5">
      {running ? (
        <button
          type="button"
          onClick={onPause}
          className="rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-200 hover:bg-black/50"
          title="Pause"
        >
          ⏸ Pause
        </button>
      ) : resumable ? (
        <button
          type="button"
          onClick={onResume}
          className="rounded-md border border-panel-border bg-accent-soft px-2 py-1 text-xs text-accent hover:bg-accent/30"
          title="Resume"
        >
          {researchLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onStop}
        className="rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-200 hover:bg-error/30 hover:text-white"
        title="Stop session"
      >
        ■ Stop
      </button>
      <button
        type="button"
        onClick={onToggleVoice}
        className={`rounded-md border border-panel-border px-2 py-1 text-xs transition ${
          ttsEnabled
            ? "bg-accent/20 text-accent hover:bg-accent/30"
            : "bg-black/30 text-neutral-500 hover:bg-black/50 hover:text-neutral-300"
        }`}
        title={ttsEnabled ? "Voice on — click to mute" : "Voice off — click to enable"}
      >
        {ttsEnabled ? "🔊" : "🔇"}
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        className="ml-auto rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-300 hover:bg-black/50"
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
