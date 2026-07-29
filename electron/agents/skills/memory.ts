// memory — facts that survive to the next session.
//
// Shared by all three agents, with a per-agent line about what is worth
// remembering in that mode (a tutor remembers what you understand; a coach
// remembers that your VPN blocks the sync port).
//
// The recalled facts are resolved ONCE at session start and passed in
// unchanged on every tick — if they were re-ranked per turn the prompt prefix
// would churn and the cache would collapse.

import type { Skill } from "../harness/types";

const BASE_RULES = `Memory across sessions — you meet this user again. "notes" is your scratchpad for THIS session; "remember" is different: it records a fact that will still be true and still be useful the NEXT time they start a session, days from now.
- Set "remember" at most once every few turns, and only for something durable.
- Do NOT remember anything transient: what's on screen right now, which step they're on, or how this session is going.
- Do NOT remember anything sensitive: passwords, card numbers, security answers, or personal details they didn't volunteer as relevant to the task.
- Keep it under 20 words and write it as a standalone fact — future-you sees the sentence with none of this session's context.
- The context header shows what you already remember. Never re-record something already there, and never read the list back to the user — just quietly use it. If the screen contradicts a remembered fact, believe the screen.`;

const REMEMBER_FIELD = {
  name: "remember",
  on: "both" as const,
  // Plain "object" rather than a nullable type union: the field is optional,
  // so "nothing to record" is expressed by omitting it. A type array is
  // outside the JSON Schema subset the API is documented to accept, and this
  // schema is on the cached prefix of every single call.
  schema: {
    type: "object",
    description:
      "A durable cross-session fact. Omit this field entirely on almost every turn.",
    properties: {
      kind: {
        type: "string",
        enum: ["setup", "preference", "history", "obstacle"],
      },
      content: { type: "string", description: "The fact, under 20 words." },
    },
    required: ["kind", "content"],
  },
};

const RECALL_BLOCK = (ctx: { recalledMemory?: string }) =>
  ctx.recalledMemory && ctx.recalledMemory.trim().length > 0
    ? [ctx.recalledMemory.trim()]
    : [];

/**
 * Build the memory skill with a mode-specific line about what is worth
 * keeping. Same mechanism everywhere; only the judgement differs.
 */
export function memorySkill(worthRemembering: string): Skill {
  return {
    id: "memory",
    systemFragment: `${BASE_RULES}\n- ${worthRemembering}`,
    contextBlocks: RECALL_BLOCK,
    outputFields: [REMEMBER_FIELD],
  };
}

export const TECH_SUPPORT_MEMORY = `Worth remembering here: their setup ("they're on the Windows desktop app, not the web version"), a preference ("prefers keyboard shortcuts over menus"), or a problem and its fix ("their VPN blocks the sync port — turning it off fixes uploads").`;

export const TRAINING_MEMORY = `Worth remembering here: how this user's environment is set up, and how they prefer their processes documented.`;

export const TEACHER_MEMORY = `Worth remembering here: what this learner already understands and how they prefer to learn, so a future session doesn't start from zero. Never record anything about their performance that would embarrass them to read back.`;
