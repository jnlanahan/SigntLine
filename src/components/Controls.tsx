import type { SessionStatus } from "../lib/api";

interface Props {
  status: SessionStatus;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onOpenSettings(): void;
}

export function Controls({
  status,
  onPause,
  onResume,
  onStop,
  onOpenSettings,
}: Props) {
  const running = status === "watching" || status === "thinking";
  const paused = status === "paused";
  return (
    <div className="no-drag flex items-center gap-1.5">
      {running ? (
        <button
          onClick={onPause}
          className="rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-200 hover:bg-black/50"
          title="Pause capture and API calls"
        >
          ⏸ Pause
        </button>
      ) : paused ? (
        <button
          onClick={onResume}
          className="rounded-md border border-panel-border bg-accent-soft px-2 py-1 text-xs text-accent hover:bg-accent/30"
          title="Resume capture"
        >
          ▶ Resume
        </button>
      ) : null}
      <button
        onClick={onStop}
        className="rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-200 hover:bg-error/30 hover:text-white"
        title="Stop session"
      >
        ■ Stop
      </button>
      <button
        onClick={onOpenSettings}
        className="ml-auto rounded-md border border-panel-border bg-black/30 px-2 py-1 text-xs text-neutral-300 hover:bg-black/50"
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
