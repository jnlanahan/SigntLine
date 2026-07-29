// The Training agent — watches an expert demonstrate a workflow and turns it
// into a reusable, step-by-step plan.
//
// Skills, in prompt order:
//   speech   → voice rules + the instruction field
//   observe  → silence discipline; wait is the norm
//   plan     → completed_steps IS the deliverable, WITH the atomic edit tools
//   notes    → within-session scratchpad
//   memory   → durable facts about the user's setup
//
// It shares the say/wait pair with the other agents on purpose: a mode whose
// whole job is to stay quiet needs an explicit way to say nothing. Without
// one, every turn parses as "speak" — which is how this mode once ended up
// reading its own JSON out loud.
//
// This is the agent slated to grow. Its plan skill already carries the atomic
// edit tools (plan_add_step / plan_revise_step / plan_complete_step) so richer
// plan tracking has somewhere to land, and it can afford the round trips they
// cost: it polls once a minute, not every fifteen seconds.

import type { Agent } from "./harness/types";
import { speechSkill } from "./skills/speech";
import { observeSkill, TRAINING_CAPTURE_RULES } from "./skills/observe";
import { planSkill } from "./skills/plan";
import { notesSkill } from "./skills/notes";
import { memorySkill, TRAINING_MEMORY } from "./skills/memory";
import { PLAN_RESEARCH_RULE } from "./shared";

const INTRO = `You are a quiet observer building a training plan. The user already knows how to do this task — you are documenting what THEY do, so someone else can follow it later. You can see their screen.`;

export const trainingAgent: Agent = {
  id: "training",
  intro: INTRO,
  skills: [
    speechSkill,
    observeSkill,
    planSkill({
      completedMeaning: "the training plan itself, in order — each entry one action-verb phrase a future trainee could follow.",
      upcomingMeaning:
        "what you expect them to demonstrate next, based on the workflow so far —",
      extraRules: TRAINING_CAPTURE_RULES,
      withTools: true,
    }),
    notesSkill,
    memorySkill(TRAINING_MEMORY),
  ],
  loop: {
    minCallSpacingMs: 10_000,
    normalIntervalMs: 60_000,
    slowIntervalMs: 60_000,
    // No input trigger: an observer that reacts to every keystroke isn't
    // observing, it's hovering.
    quietPeriodMs: 0,
    stallEnabled: false,
    requireScreenChange: true,
  },
  // Room for a couple of plan edits before the turn has to end. Affordable
  // here — a 60s poll means nobody is waiting on the round trip.
  maxToolIterations: 4,
  nextTurnPrompt: `Look at the latest screenshot. If a step visibly completed that isn't in the plan yet, record it. Then end your turn — remember that "wait" is the normal answer.`,
  guidance: {
    stalled: `The screen has been still for a while. If they've finished a section, ask whether to move on; if they've stopped mid-workflow, ask whether they want to pick it up later. Keep it to one short question.`,
    sessionStart: `The session just started. Ask your first scoping question now (say, action=instruct): who this training is for, or what a trainee should be able to do at the end. Do not call wait, and do not set digression on this turn.`,
    followUp: `The user just asked you something directly (see the follow-up in this turn's message). Answer it now — you must call say, never wait, even though wait is your normal answer while observing. Keep it short and stay in your role: answer about the plan you're building, don't start telling them how to do the task.`,
  },
  clarificationPrompt: `You are helping scope a training plan. Given what the user wants to document, generate exactly 2-3 short, specific questions that pin down who the training is for, what process it covers, and how much detail it needs. For each question, provide 3-4 answer options: the first 2 should be the most common/recommended answers, the rest are reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["recommended 1", "recommended 2", "alternative 1", "alternative 2"]}]}`,
  planPrompt: `You generate a brief plan for a training-capture session. Given what the user wants to document, produce a casual spoken overview (under 60 words) telling them you'll watch and stay out of the way, plus 3-6 sections you expect the workflow to cover. Name the actual screens, features, or steps involved — not generic phrases like "record the process".

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"overview": "...", "steps": ["...", "...", "..."]}`,
};
