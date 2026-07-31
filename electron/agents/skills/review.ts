// review — training's check-my-work and I'm-stuck behaviours, plus the
// verdict and mistake-pattern fields that feed the plan's long-term memory.
//
// The two buttons arrive as follow-up messages carrying bracketed markers
// (see CHECK_MY_WORK_FOLLOW_UP / STUCK_FOLLOW_UP in electron/types.ts) — the
// follow-up path already bypasses call spacing and forbids a silent answer,
// which is exactly what a button press needs.
//
// The grading rules are borrowed from a human-tested trainer playbook: name
// what's right first, fix at most one thing per response, never pass work
// that isn't done. The point of "one thing" is retention — a list of five
// corrections teaches none of them.

import type { Skill } from "../harness/types";

export const reviewSkill: Skill = {
  id: "review",
  systemFragment: `Checking their work:

A follow-up starting with "[check-my-work]" means the user thinks the current task is done. Grade what you can see against the task's done criteria (in your context):
- Start with what's specifically right — name the real thing on screen, not generic praise.
- Fix at most ONE thing per response, the most important one. Save the rest for the next check.
- Set task_verdict: "pass" only when the done criteria are visibly met. Never pass work that isn't there — a kind "not_yet" now beats confusion later. On "pass", say what the next task is in one sentence.
- If an earlier attempt is attached, compare: call out what improved.
- If you genuinely can't see enough to judge, ask them to bring the work on screen — and set no verdict.

A follow-up starting with "[stuck]" means they want help getting unstuck:
- Respond with a question or the smallest hint that gets them moving — never the full answer, never do it for them.
- If they say they're STILL stuck after a hint, give progressively more, one rung at a time.

Set task_verdict ONLY on a [check-my-work] turn. Any other follow-up is just a question — answer it briefly and let them get back to work.

"mistake_pattern": when you notice the same KIND of mistake for the second time (across checks or sessions), record it as a short phrase — "renames columns by editing raw data instead of headers". Your context lists the patterns already on file; never re-record one, and never recite the list at the user.`,
  contextBlocks(ctx) {
    return ctx.trainingContext && ctx.trainingContext.trim().length > 0
      ? [ctx.trainingContext.trim()]
      : [];
  },
  outputFields: [
    {
      name: "task_verdict",
      on: "say",
      schema: {
        type: "string",
        enum: ["pass", "not_yet"],
        description:
          'The check-my-work verdict. Set ONLY on a "[check-my-work]" follow-up turn; omit on every other turn.',
      },
    },
    {
      name: "mistake_pattern",
      on: "say",
      schema: {
        type: "string",
        description:
          "A recurring kind of mistake worth remembering for future feedback, under 12 words. Omit on almost every turn.",
      },
    },
  ],
};
