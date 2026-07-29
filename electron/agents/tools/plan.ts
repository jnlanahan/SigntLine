// Plan mutation tools — the seam the Training agent grows into.
//
// Today an agent revises its plan by rewriting `upcoming_steps` wholesale on
// the terminal tool. That works while a plan is 3-6 throwaway strings. It
// stops working once a plan is the deliverable — a wholesale rewrite has no
// diff, so you cannot tell "step 3 was corrected" from "the whole plan was
// regenerated and step 3 happens to differ", and nothing is undoable.
//
// These tools make each change an explicit, logged, reversible edit. They are
// deliberately minimal right now: three operations over a flat list. The
// Training agent's richer plan model (per-step detail, evidence, ordering)
// grows here rather than in a new place.

import type { AgentTool, PlanEdit } from "../harness/types";

function index(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : -1;
}

export const planAddStepTool: AgentTool = {
  name: "plan_add_step",
  description:
    "Append a step to the plan you are building. Use this the moment you see a step finish on screen, rather than waiting to rewrite the whole plan later. One action-verb phrase, under 8 words, naming the real button, menu, or field you saw.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "The step, as an action phrase under 8 words.",
      },
    },
    required: ["description"],
  },
  async run(input, deps) {
    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    if (!description) return { text: "No step text given.", isError: true };
    deps.planDraft.edits.push({ op: "add", description });
    return { text: `Recorded step: "${description}"` };
  },
};

export const planReviseStepTool: AgentTool = {
  name: "plan_revise_step",
  description:
    "Rewrite one step already in the plan, by its 0-based position. Use this when the user redoes or corrects something — the plan should describe the right way, not the fumbling. Revising replaces the step; it does not add a second one.",
  inputSchema: {
    type: "object",
    properties: {
      index: { type: "integer", description: "0-based position of the step to replace." },
      description: { type: "string", description: "The corrected step text." },
    },
    required: ["index", "description"],
  },
  async run(input, deps) {
    const i = index(input.index);
    const description =
      typeof input.description === "string" ? input.description.trim() : "";
    if (i < 0) return { text: "Give a 0-based step index.", isError: true };
    if (!description) return { text: "No step text given.", isError: true };
    deps.planDraft.edits.push({ op: "revise", index: i, description });
    return { text: `Revised step ${i} to: "${description}"` };
  },
};

export const planCompleteStepTool: AgentTool = {
  name: "plan_complete_step",
  description:
    "Mark a planned step as done, by its 0-based position in the upcoming steps. Only call this once the screen shows it actually finished.",
  inputSchema: {
    type: "object",
    properties: {
      index: { type: "integer", description: "0-based position in the upcoming steps." },
    },
    required: ["index"],
  },
  async run(input, deps) {
    const i = index(input.index);
    if (i < 0) return { text: "Give a 0-based step index.", isError: true };
    deps.planDraft.edits.push({ op: "complete", index: i });
    return { text: `Marked step ${i} complete.` };
  },
};

export const PLAN_TOOLS: AgentTool[] = [
  planAddStepTool,
  planReviseStepTool,
  planCompleteStepTool,
];

/**
 * Apply this turn's edits to the plan the terminal tool reported.
 *
 * Pure, so the merge order is testable without a model in the loop. Edits are
 * applied in call order against the terminal tool's lists, which means an
 * agent that both calls plan tools AND rewrites the arrays gets the tool edits
 * layered on top — the more specific intent wins.
 */
export function applyPlanEdits(
  completed: string[],
  upcoming: string[],
  edits: PlanEdit[],
): { completed: string[]; upcoming: string[] } {
  const done = [...completed];
  const next = [...upcoming];
  for (const edit of edits) {
    switch (edit.op) {
      case "add":
        if (!done.includes(edit.description)) done.push(edit.description);
        break;
      case "revise":
        if (edit.index < done.length) done[edit.index] = edit.description;
        break;
      case "complete": {
        if (edit.index >= next.length) break;
        const [moved] = next.splice(edit.index, 1);
        if (moved && !done.includes(moved)) done.push(moved);
        break;
      }
    }
  }
  return { completed: done, upcoming: next };
}
