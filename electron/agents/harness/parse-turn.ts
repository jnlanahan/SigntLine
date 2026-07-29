// Turns a terminal tool call into the InstructionResponse the session loop
// already consumes.
//
// The response shape is deliberately unchanged from the pre-harness JSON era:
// everything downstream (glow highlight, memory writes, research, notes, the
// stall ladder's pace scaling) keeps working untouched. What changed is where
// the fields come from — a validated tool input instead of a hand-extracted
// JSON blob.
//
// Pure module — unit-testable from src/__tests__.

import type { InstructionResponse } from "../../types";
import { parseHighlight, parseRemember } from "../../instruction-parse";
import { SAY_TOOL } from "./types";

const VALID_ACTIONS = new Set(["instruct", "acknowledge", "check_in", "done"]);
const VALID_PACES = new Set(["quick", "medium", "long"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v) ? v.map(String) : fallback;
}

/**
 * Build the turn result from whichever terminal tool the model called.
 *
 * `wait` produces the same silent-turn shape the loop has always handled:
 * empty instruction, no highlight, but bookkeeping fields intact — a silent
 * turn still records completed steps, notes, and memory.
 */
export function parseTerminalTool(
  toolName: string,
  input: Record<string, unknown>,
  previousSteps: string[],
): InstructionResponse {
  const speaking = toolName === SAY_TOOL;

  const rawAction = str(input.action);
  // A `say` with an unrecognized action still speaks — dropping the turn
  // because of one bad enum value would lose the sentence the user is
  // already hearing (speech streams before this parse runs).
  const action: InstructionResponse["action"] = speaking
    ? VALID_ACTIONS.has(rawAction)
      ? (rawAction as InstructionResponse["action"])
      : "instruct"
    : "wait";

  const pace = str(input.expected_pace);

  return {
    action,
    expectedPace: VALID_PACES.has(pace)
      ? (pace as InstructionResponse["expectedPace"])
      : "medium",
    instruction: speaking ? str(input.instruction) : "",
    // Only an "instruct" predicts a visible outcome — that pairing is what the
    // verify skill round-trips on the next turn.
    expectedResult: action === "instruct" ? str(input.expected_result) : "",
    troubleshooting: Boolean(input.troubleshooting),
    completedSteps: strArray(input.completed_steps, previousSteps),
    upcomingSteps: strArray(input.upcoming_steps, []),
    digression: Boolean(input.digression),
    done: action === "done",
    // Research is a real tool now. These two fields survive only so the
    // renderer's legacy research path stays a working fallback for an agent
    // whose skill set has no search_web tool.
    needsResearch: Boolean(input.needsResearch),
    researchQuery: str(input.researchQuery),
    notes: str(input.notes),
    highlight: action === "instruct" ? parseHighlight(input.highlight) : null,
    remember: parseRemember(input.remember),
  };
}
