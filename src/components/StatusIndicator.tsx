import type { SessionStatus } from "../lib/api";

interface Props {
  status: SessionStatus;
  rateLimitCountdown: number | null;
}

const LABELS: Record<SessionStatus, string> = {
  idle: "Idle",
  watching: "Watching",
  thinking: "Thinking",
  waiting: "Waiting",
  paused: "Paused",
  error: "Error",
};

const COLORS: Record<SessionStatus, string> = {
  idle: "bg-waiting",
  watching: "bg-watching",
  thinking: "bg-thinking",
  waiting: "bg-waiting",
  paused: "bg-waiting",
  error: "bg-error",
};

export function StatusIndicator({ status, rateLimitCountdown }: Props) {
  const pulses = status === "watching" || status === "thinking";
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-300">
      <span
        className={`inline-block h-2 w-2 rounded-full ${COLORS[status]} ${
          pulses ? "pulse-dot" : ""
        }`}
      />
      <span className="font-medium">{LABELS[status]}</span>
      {rateLimitCountdown !== null && rateLimitCountdown > 0 && (
        <span className="text-thinking">· retry in {rateLimitCountdown}s</span>
      )}
    </div>
  );
}
