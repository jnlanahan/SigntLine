// Turn live session state into the persistable record.
//
// Pure so the shape written to history is unit-testable without touching disk
// or Electron — history is the thing users will look back on, and a silently
// malformed record is worse than no record.

import type {
  SessionOutcome,
  SessionRecord,
  SessionStepRecord,
  SessionTurnRecord,
} from "../../electron/db/schema";
import type { AppMode, ConversationTurn, TokenUsage } from "./api";

export interface SessionSnapshot {
  id: string;
  mode: AppMode;
  goal: string;
  startedAt: number;
  endedAt: number;
  done: boolean;
  verdict: string | null;
  completedSteps: string[];
  currentInstruction: string;
  upcomingSteps: string[];
  conversation: ConversationTurn[];
  usage: TokenUsage;
  costUsd: number;
  claudeCalls: number;
}

/**
 * A session counts as completed when the coach declared the goal met, or an
 * evaluation said so. Anything else the user walked away from is "abandoned";
 * a session with no progress at all is "unknown" rather than a failure, since
 * opening the app and closing it isn't a failed session.
 */
export function deriveOutcome(snapshot: {
  done: boolean;
  completedSteps: string[];
  conversation: ConversationTurn[];
}): SessionOutcome {
  if (snapshot.done) return "completed";
  const hadRealActivity =
    snapshot.completedSteps.length > 0 ||
    snapshot.conversation.some((t) => t.role === "assistant");
  return hadRealActivity ? "abandoned" : "unknown";
}

function buildSteps(snapshot: SessionSnapshot): SessionStepRecord[] {
  const steps: SessionStepRecord[] = snapshot.completedSteps.map((d, i) => ({
    idx: i,
    description: d,
    state: "completed" as const,
    expectedResult: null,
    completedAt: snapshot.endedAt,
  }));
  // The instruction in flight when the session ended is only "current" if the
  // session didn't finish — otherwise everything is done.
  if (snapshot.currentInstruction && !snapshot.done) {
    steps.push({
      idx: steps.length,
      description: snapshot.currentInstruction,
      state: "current",
      expectedResult: null,
      completedAt: null,
    });
  }
  for (const d of snapshot.upcomingSteps) {
    steps.push({
      idx: steps.length,
      description: d,
      state: "upcoming",
      expectedResult: null,
      completedAt: null,
    });
  }
  return steps;
}

function buildTurns(snapshot: SessionSnapshot): SessionTurnRecord[] {
  return (
    snapshot.conversation
      // "Goal: ..." is the synthetic opening turn the app injects; the goal is
      // already a column, so keeping it would duplicate it in the transcript.
      .filter((t) => !(t.role === "user" && t.content.startsWith("Goal: ")))
      .map((t, i) => ({
        idx: i,
        role: t.role,
        content: t.content,
        createdAt: t.timestamp,
      }))
  );
}

export function buildSessionRecord(snapshot: SessionSnapshot): SessionRecord {
  return {
    id: snapshot.id,
    // Populated once auth exists; every row carries the column already.
    userId: null,
    mode: snapshot.mode,
    goal: snapshot.goal,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    outcome: deriveOutcome(snapshot),
    verdict: snapshot.verdict,
    costUsd: snapshot.costUsd,
    inputTokens: snapshot.usage.inputTokens,
    outputTokens: snapshot.usage.outputTokens,
    cacheReadTokens: snapshot.usage.cacheReadTokens,
    cacheWriteTokens: snapshot.usage.cacheCreationTokens,
    claudeCalls: snapshot.claudeCalls,
    steps: buildSteps(snapshot),
    turns: buildTurns(snapshot),
  };
}

/**
 * Whether a session is worth keeping. Opening the app, typing a goal, and
 * immediately stopping produces a record nobody wants in their history.
 */
export function isWorthSaving(record: SessionRecord): boolean {
  return record.turns.length > 0 || record.steps.length > 0;
}
