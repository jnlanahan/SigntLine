// plan — the running list of what's done and what's next.
//
// Shared by all three agents, but what a "step" MEANS differs per mode, so the
// step description is a parameter: tech support tracks the user's progress
// through a task, training records the expert's demonstrated workflow, teacher
// tracks concepts covered.
//
// `withTools` is the Training seam. Only the agent that needs atomic,
// diffable plan edits pays the extra round trip for them.

import type { Skill } from "../harness/types";
import { PLAN_TOOLS } from "../tools/plan";

const DIGRESSION_RULE = `"digression" is true ONLY when the screen clearly shows the user has navigated away from the task to something unrelated (social media, personal browsing, a completely different app). Do NOT set it for normal task navigation (switching browsers, opening a referenced file, checking docs). When it is true, say a short warm pause line like "No worries — take your time. I'll be right here when you're ready." and leave upcoming_steps empty.`;

export interface PlanSkillOptions {
  /** What "completed_steps" means in this mode. */
  completedMeaning: string;
  /** What "upcoming_steps" means in this mode. */
  upcomingMeaning: string;
  /** Extra mode-specific plan rules. */
  extraRules?: string;
  /** Give this agent the atomic plan-edit tools (Training). */
  withTools?: boolean;
}

export function planSkill(opts: PlanSkillOptions): Skill {
  const parts = [
    `The plan:\n- "completed_steps" is ${opts.completedMeaning} Report the FULL running list every turn, as short phrases (3-7 words each). Never duplicate an entry.\n- "upcoming_steps" is ${opts.upcomingMeaning} 2-4 short phrases. Use an empty array in the final stretch or when the next steps are genuinely unclear.`,
    DIGRESSION_RULE,
  ];
  if (opts.extraRules) parts.push(opts.extraRules);
  if (opts.withTools) {
    parts.push(
      `You also have plan_add_step, plan_revise_step, and plan_complete_step. Prefer them over rewriting the whole list: they record one change at a time, so a correction reads as a correction rather than as a brand-new plan. Rewriting "completed_steps" wholesale is still fine for small tidying.`,
    );
  }

  return {
    id: "plan",
    systemFragment: parts.join("\n\n"),
    tools: opts.withTools ? PLAN_TOOLS : undefined,
    contextBlocks(ctx) {
      if (ctx.upcomingSteps.length === 0) return [];
      // Numbered from 0 because that is what the plan tools index into. A
      // 1-based display here would make every plan_complete_step call land on
      // the wrong step.
      return [
        `Your current plan for what's next (0-based, as you last reported it):\n` +
          ctx.upcomingSteps.map((s, i) => `  ${i}. ${s}`).join("\n"),
      ];
    },
    outputFields: [
      {
        name: "completed_steps",
        on: "both",
        schema: {
          type: "array",
          items: { type: "string" },
          description: "The full running list of completed steps, in order.",
        },
      },
      {
        name: "upcoming_steps",
        on: "both",
        schema: {
          type: "array",
          items: { type: "string" },
          description: "2-4 predicted next steps, or an empty array.",
        },
      },
      {
        name: "digression",
        on: "both",
        schema: {
          type: "boolean",
          description:
            "True only when the screen shows the user has gone somewhere unrelated to the task.",
        },
      },
    ],
  };
}
