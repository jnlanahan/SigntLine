// The Teacher agent — a Socratic tutor for learning a subject, rather than
// completing a task.
//
// Skills, in prompt order:
//   speech        → voice rules + the instruction field
//   socratic      → one concept at a time, then check understanding
//   research      → the DEFERRED variant, not the live tool (see below)
//   screenReading → read what the learner has open, properly
//   plan          → concepts covered / coming up
//   notes         → within-session scratchpad
//   memory        → what they already know, so it isn't re-taught
//
// Conversation-driven: the loop does not auto-poll here, so the agent only
// speaks when the learner says something. It still needs `wait`, because a
// turn with nothing to add must be able to say so rather than filling silence.
//
// Deliberately uses deferredResearchSkill rather than the live search tool.
// Recommending a real paper or course is not urgent enough to make a learner
// sit through an extra round trip mid-sentence, and the app's out-of-band
// research path already surfaces it as a visible "looking that up" state.

import type { Agent } from "./harness/types";
import { speechSkill } from "./skills/speech";
import { socraticSkill } from "./skills/socratic";
import { deferredResearchSkill } from "./skills/research";
import { screenReadingSkill } from "./skills/screen-reading";
import { planSkill } from "./skills/plan";
import { notesSkill } from "./skills/notes";
import { memorySkill, TEACHER_MEMORY } from "./skills/memory";
import { PLAN_RESEARCH_RULE } from "./shared";

const INTRO = `You are an engaging Socratic tutor. You help the user genuinely understand a subject — through dialogue, not lecture. You can see their screen, so if they have a source open, teach against what's actually in front of them.`;

export const teacherAgent: Agent = {
  id: "teacher",
  intro: INTRO,
  skills: [
    speechSkill,
    socraticSkill,
    deferredResearchSkill,
    screenReadingSkill,
    planSkill({
      completedMeaning:
        "the running list of concepts you've genuinely covered — added only once the user has shown they follow it, not when you first mention it.",
      upcomingMeaning: "where you plan to go next —",
      extraRules: `Update "upcoming_steps" as their interests move.`,
    }),
    notesSkill,
    memorySkill(TEACHER_MEMORY),
  ],
  loop: {
    minCallSpacingMs: 2_000,
    // No auto-poll at all — this mode is driven entirely by the learner
    // speaking. The scheduled chain exits immediately; a follow-up is the
    // only thing that wakes it.
    normalIntervalMs: 0,
    slowIntervalMs: 0,
    quietPeriodMs: 0,
    stallEnabled: false,
    requireScreenChange: false,
  },
  // One look at a source, then answer. A tutor mid-conversation should not go
  // quiet for several seconds while it rummages.
  maxToolIterations: 2,
  nextTurnPrompt: `Respond to the user's message. Teach the next concept or answer their question directly and conversationally, then check understanding. If they have a source open and the part that matters is too small to read, zoom in first.`,
  guidance: {
    stalled: `They've been quiet for a while. They may be reading or thinking — that's fine. Only check in if you haven't spoken recently, and keep it to one light question.`,
    sessionStart: `The session just started. Open now (say, action=instruct): find out what they already know about this subject and what they want to be able to do by the end. Do not call wait, and do not set digression on this turn.`,
    followUp: `The learner just asked you something directly (see the follow-up in this turn's message). Answer it now — you must call say, never wait. This mode only speaks when they do, so a silent turn here leaves their question hanging.`,
  },
  clarificationPrompt: `You are helping a learner set up a study session. Given the subject they want to learn, generate exactly 2-3 short, specific questions that pin down their current level, what they want to get out of it, and how they prefer to learn. For each question, provide 3-4 answer options: the first 2 should be the most common/recommended answers, the rest are reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["recommended 1", "recommended 2", "alternative 1", "alternative 2"]}]}`,
  planPrompt: `You generate a brief learning-session plan. Given the subject and the learner's answers, produce a casual spoken overview (under 60 words) of what you'll explore together, plus 3-6 specific concepts or questions you'll work through. Each step names a concrete idea — not a generic phase like "introduction" or "wrap up".

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"overview": "...", "steps": ["...", "...", "..."]}`,
};
