// Prompt text shared by the pre-session planners.
//
// The per-tick prompt is no longer built from shared blobs — voice rules and
// field rules became skills (see ./skills/), which is what lets agents mix and
// match them. What's left here is the one rule that belongs to the planning
// call, which runs before any agent loop starts and uses Anthropic's
// server-side web_search tool directly.

export const PLAN_RESEARCH_RULE = `You have a "web_search" tool. The user is a non-expert who needs accurate, current steps — do not guess. If the goal depends on specifics you are not fully sure of (a product's current UI, exact menu paths, a specific command or setting, recent app changes), search the web FIRST and base the plan on what you find. If a screenshot of the user's screen is attached, read it: tailor the plan to what they actually have open (their OS, app, and where they are in the task). After any searching, output the plan and nothing else.`;
