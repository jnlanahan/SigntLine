// Pure decision logic for the session loop: given what a tick knows, should
// it call Claude, and why / why not? Extracted from useSessionLoop so the
// gate can be unit-tested and every decision can be logged with its reason.

export type TickReason = "backstop" | "input" | "followup" | "manual";

export interface TickGateInput {
  reason: TickReason;
  // tech_support/training: only call Claude when something happened.
  requireScreenChange: boolean;
  // The frame comparator's verdict (distance > similarity threshold).
  screenChanged: boolean;
  // Changed-cell count between this frame and the last processed one.
  // Infinity = incomparable (first frame, resolution change).
  screenDistance: number;
  hasPendingFollowUp: boolean;
  stalled: boolean;
}

export interface TickGateResult {
  proceed: boolean;
  why: string;
}

export function shouldCallClaude(g: TickGateInput): TickGateResult {
  if (!g.requireScreenChange) {
    return { proceed: true, why: "mode-always-calls" };
  }
  if (g.hasPendingFollowUp) return { proceed: true, why: "follow-up" };
  if (g.screenChanged) {
    return { proceed: true, why: `screen-changed(d=${g.screenDistance})` };
  }
  // Real user input plus ANY sub-threshold pixel movement: the comparator
  // can miss small-but-meaningful changes (a clicked tab, a toggled
  // setting), but input + a nonzero nudge means something happened — let
  // Claude look and decide. Pure mouse travel scores d=0 and stays skipped.
  if (g.reason === "input" && g.screenDistance >= 1) {
    return { proceed: true, why: `input-nudge(d=${g.screenDistance})` };
  }
  if (g.stalled) return { proceed: true, why: "stalled" };
  return {
    proceed: false,
    why: `no-change(d=${Number.isFinite(g.screenDistance) ? g.screenDistance : "n/a"})`,
  };
}
