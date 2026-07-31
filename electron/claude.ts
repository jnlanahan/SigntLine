import Anthropic from "@anthropic-ai/sdk";
import type {
  AppMode,
  CaptureFrame,
  Clarification,
  ClarificationResponse,
  ConversationTurn,
  GoalEvaluation,
  InstructionResponse,
  SessionPlan,
} from "./types";
import { getKey } from "./credentials";
import { toContextResolution } from "./capture";
import type { SpeechChunk } from "./speech-chunker";
import { extractJson } from "./instruction-parse";
import { PLAN_RESEARCH_RULE } from "./agents/shared";
import { getAgent } from "./agents/registry";
import { MODULE_DETAIL_PROMPT } from "./agents/training";
import { outlineForPrompt } from "./training-plan";
import type { CurriculumOutline, ModuleTaskDetail } from "./training-plan";
import type { TrainingPlan } from "./db/schema";
import { runAgentTurn } from "./agents/harness/runner";
import { newPlanDraft, type ToolDeps } from "./agents/harness/types";
import { applyPlanEdits } from "./agents/tools/plan";

// Re-exported so main.ts's error handling is unaffected by the harness move.
export { MissingApiKeyError, RateLimitError } from "./agents/harness/errors";
import { MissingApiKeyError } from "./agents/harness/errors";

const MODEL = "claude-sonnet-4-6";

/**
 * Everything the harness needs that it cannot get itself. Supplied by main.ts,
 * which owns the screen and the network; the agents package stays Electron-free
 * so the whole harness is unit-testable.
 */
export interface AgentRuntime {
  captureRegion: ToolDeps["captureRegion"];
  log(message: string): void;
}

export interface NextInstructionArgs {
  mode: AppMode;
  goal: string;
  completedSteps: string[];
  // The plan the agent reported last turn. Round-tripped so it can see its own
  // plan — without it, a plan_complete_step index refers to a list the model
  // is only guessing at.
  upcomingSteps?: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  followUp?: string;
  clarificationContext?: string;
  // Reference material the user attached (text/markdown files).
  uploadedContext?: string;
  // Notes the agent recorded on previous turns, oldest to newest.
  agentNotes?: string[];
  // Facts recalled from EARLIER sessions, already selected and formatted by
  // the memory ranker. Resolved once at session start so it stays byte-stable
  // across ticks rather than churning the prompt every turn.
  recalledMemory?: string;
  // Training mode: the active plan's context block (learner profile, module
  // outline, current task, mistake patterns). Re-resolved only when the plan
  // itself changes, so the header stays cache-friendly.
  trainingContext?: string;
  // Training mode: this task's previous check-my-work frame (data URL), sent
  // on a check turn so the coach can compare attempts.
  referenceFrame?: string;
  // The visible outcome the agent predicted for its last instruction —
  // round-tripped so it can verify the step happened before advancing.
  lastExpectedResult?: string;
  // Pacing context (tech_support): how long since the screen last changed
  // and since the assistant last spoke, plus whether the loop considers the
  // user stalled on the current step.
  secondsSinceScreenChange?: number;
  secondsSinceLastSpoke?: number;
  stalled?: boolean;
  // True on the very first look after the session starts — the model must
  // give the first step, not wait.
  sessionJustStarted?: boolean;
  // Whether the frame comparator saw a change since the last processed frame.
  // False means the history frame would be a duplicate, so it is dropped.
  screenChanged?: boolean;
}

/**
 * One agent turn.
 *
 * The whole per-tick body now lives in the harness (electron/agents/harness/).
 * This function's job is the boundary work the harness deliberately does not
 * do: resolve the API key, pick the agent for the mode, wire the tool
 * dependencies that need Electron, and fold any plan edits into the result.
 *
 * The returned shape is unchanged from the pre-harness era, so every consumer
 * downstream — glow highlight, memory writes, the stall ladder's pace scaling
 * — keeps working untouched.
 */
export async function getNextInstruction(
  args: NextInstructionArgs,
  // Called with each completed sentence while the response is still
  // streaming, so TTS starts on sentence one instead of waiting for the whole
  // turn. Never fires when the agent calls `wait`.
  onSpeechChunk?: (chunk: SpeechChunk) => void,
  runtime?: AgentRuntime,
): Promise<InstructionResponse> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const agent = getAgent(args.mode);
  const log = runtime?.log ?? (() => {});

  const deps: ToolDeps = {
    // Without a runtime the zoom tool degrades to "look at what you have"
    // rather than failing the turn — a missing capability must never take the
    // coach offline.
    captureRegion:
      runtime?.captureRegion ??
      (async () => null),
    research: runWebResearch,
    planDraft: newPlanDraft(),
    log,
  };

  const result = await runAgentTurn({
    client,
    model: MODEL,
    agent,
    ctx: { ...args, upcomingSteps: args.upcomingSteps ?? [] },
    deps,
    toContextResolution,
    onSpeechChunk,
    log,
  });

  if (result.planEdits.length > 0) {
    const merged = applyPlanEdits(
      result.completedSteps,
      result.upcomingSteps,
      result.planEdits,
    );
    result.completedSteps = merged.completed;
    result.upcomingSteps = merged.upcoming;
    log(
      `[agent:${agent.id}] applied ${result.planEdits.length} plan edit(s) → ${merged.completed.length} done, ${merged.upcoming.length} upcoming`,
    );
  }

  // planEdits are internal bookkeeping — already applied above, and not
  // something the renderer should see or act on again.
  const { planEdits: _applied, ...response } = result;
  return response;
}

function extractText(resp: Anthropic.Messages.Message): string {
  return resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function mediaTypeOf(dataUrl: string): ImageMediaType {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));/.exec(dataUrl);
  return (m?.[1] as ImageMediaType) ?? "image/png";
}

export async function getClarifications(args: {
  mode: AppMode;
  goal: string;
}): Promise<ClarificationResponse> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const agent = getAgent(args.mode);
  // Training's deeper intake earns more questions and the tokens to ask them.
  const limit = agent.maxClarifications ?? 3;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: limit > 3 ? 800 : 400,
      system: agent.clarificationPrompt,
      messages: [{ role: "user", content: `Task: ${args.goal}` }],
    });
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { questions?: unknown };
      if (Array.isArray(obj.questions)) {
        return {
          questions: obj.questions.slice(0, limit).map((q: unknown) => {
            if (typeof q === "object" && q !== null && "question" in q && "options" in q) {
              const typed = q as { question: string; options: unknown };
              return {
                question: String(typed.question),
                options: Array.isArray(typed.options) ? typed.options.map(String) : [],
              };
            }
            // Fallback for plain string questions (backwards compat)
            return { question: String(q), options: [] };
          }),
        };
      }
    }
  } catch {
    // fail safe — never block session start
  }
  return { questions: [] };
}

export async function getSessionPlan(args: {
  mode: AppMode;
  goal: string;
  clarifications: Clarification[];
  // base64 data URL of the user's current screen, attached so the planner can
  // tailor steps to what's actually on screen. Optional.
  screenshot?: string;
}): Promise<SessionPlan> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const clarText = args.clarifications
    .filter((c) => c.answer.trim())
    .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
    .join("\n");

  const userContent: Array<
    Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam
  > = [];
  if (args.screenshot) {
    userContent.push({
      type: "text",
      text: "Here's the user's current screen for context:",
    });
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaTypeOf(args.screenshot),
        data: stripDataUrlPrefix(args.screenshot),
      },
    });
  }
  userContent.push({
    type: "text",
    text: `Goal: ${args.goal}${clarText ? `\n\nClarifications:\n${clarText}` : ""}`,
  });

  // Try with web search enabled; if the account/API rejects the tool, retry
  // without it so we still produce a plan (just without live lookups).
  async function callPlan(useWebSearch: boolean) {
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 1500,
      system: getAgent(args.mode).planPrompt,
      messages: [{ role: "user", content: userContent }],
    };
    if (useWebSearch) {
      // web_search is a server-side tool; the SDK types here predate it, so we
      // attach it loosely. The API runs the search loop and returns the final
      // plan text in one response.
      (params as { tools?: unknown }).tools = [
        { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      ];
    }
    return client.messages.create(params);
  }

  try {
    let resp;
    try {
      resp = await callPlan(true);
    } catch (err) {
      console.warn("[SightLine plan] web search unavailable, retrying without:", err);
      resp = await callPlan(false);
    }
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { overview?: string; steps?: unknown };
      if (obj.overview && Array.isArray(obj.steps)) {
        return {
          overview: String(obj.overview).trim(),
          steps: obj.steps.slice(0, 6).map(String),
        };
      }
    }
  } catch {
    // fail safe
  }
  return { overview: "", steps: [] };
}

/**
 * Training mode's pre-session call: the full curriculum OUTLINE — every
 * module's title, summary, and draft task titles, sized to the goal. The
 * modules are deliberately not detailed here; objectives and done-criteria
 * are written per module by detailTrainingModule, when that module is about
 * to start and the plan's journal shows how earlier ones actually went.
 *
 * Returns null on any failure — the UI keeps the user at the review step
 * rather than starting a session against an empty plan.
 */
export async function getCurriculumOutline(args: {
  goal: string;
  clarifications: Clarification[];
  screenshot?: string;
}): Promise<CurriculumOutline | null> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const clarText = args.clarifications
    .filter((c) => c.answer.trim())
    .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
    .join("\n");

  const userContent: Array<
    Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam
  > = [];
  if (args.screenshot) {
    userContent.push({
      type: "text",
      text: "Here's the user's current screen for context:",
    });
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaTypeOf(args.screenshot),
        data: stripDataUrlPrefix(args.screenshot),
      },
    });
  }
  userContent.push({
    type: "text",
    text: `Goal: ${args.goal}${clarText ? `\n\nIntake answers:\n${clarText}` : ""}`,
  });

  async function callOutline(useWebSearch: boolean) {
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 4000,
      system: getAgent("training").planPrompt,
      messages: [{ role: "user", content: userContent }],
    };
    if (useWebSearch) {
      (params as { tools?: unknown }).tools = [
        { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      ];
    }
    return client.messages.create(params);
  }

  try {
    let resp;
    try {
      resp = await callOutline(true);
    } catch (err) {
      console.warn("[SightLine curriculum] web search unavailable, retrying without:", err);
      resp = await callOutline(false);
    }
    const json = extractJson(extractText(resp));
    if (json) {
      const obj = JSON.parse(json) as {
        title?: unknown;
        overview?: unknown;
        learnerProfile?: unknown;
        modules?: unknown;
      };
      if (Array.isArray(obj.modules) && obj.modules.length > 0) {
        return {
          title: String(obj.title ?? "").trim(),
          overview: String(obj.overview ?? "").trim(),
          learnerProfile: String(obj.learnerProfile ?? "").trim(),
          modules: obj.modules.slice(0, 12).map((m) => {
            const mod = (m ?? {}) as {
              title?: unknown;
              summary?: unknown;
              taskTitles?: unknown;
            };
            return {
              title: String(mod.title ?? "").trim(),
              summary: String(mod.summary ?? "").trim(),
              taskTitles: Array.isArray(mod.taskTitles)
                ? mod.taskTitles.slice(0, 5).map(String)
                : [],
            };
          }),
        };
      }
    }
  } catch {
    // fail safe
  }
  return null;
}

/**
 * Write objectives and done-criteria for one module of an existing plan,
 * informed by the journal and mistake patterns — module 5 is written knowing
 * how modules 1-4 actually went. Returns null on failure; the caller retries
 * at the next session start.
 */
export async function detailTrainingModule(args: {
  plan: TrainingPlan;
  moduleIndex: number;
}): Promise<ModuleTaskDetail[] | null> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();
  const module = args.plan.modules[args.moduleIndex];
  if (!module) return null;

  const client = new Anthropic({ apiKey });
  const journal = args.plan.journal
    .slice(-10)
    .map((j) => `- ${j.note}`)
    .join("\n");
  const parts = [
    `Goal: ${args.plan.goal}`,
    args.plan.learnerProfile ? `Learner profile: ${args.plan.learnerProfile}` : "",
    outlineForPrompt(args.plan),
    args.plan.mistakePatterns.length > 0
      ? `Recurring mistake patterns:\n${args.plan.mistakePatterns.map((m) => `- ${m}`).join("\n")}`
      : "",
    journal ? `Journal of past sessions (oldest first):\n${journal}` : "",
    `Module to detail (module ${args.moduleIndex + 1}): "${module.title}" — ${module.summary}`,
    `Draft task titles:\n${module.tasks.map((t) => `- ${t.title}`).join("\n")}`,
  ].filter((p) => p.length > 0);

  async function callDetail(useWebSearch: boolean) {
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 3000,
      system: MODULE_DETAIL_PROMPT,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    };
    if (useWebSearch) {
      (params as { tools?: unknown }).tools = [
        { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      ];
    }
    return client.messages.create(params);
  }

  try {
    let resp;
    try {
      resp = await callDetail(true);
    } catch (err) {
      console.warn("[SightLine module detail] web search unavailable, retrying without:", err);
      resp = await callDetail(false);
    }
    const json = extractJson(extractText(resp));
    if (json) {
      const obj = JSON.parse(json) as { tasks?: unknown };
      if (Array.isArray(obj.tasks) && obj.tasks.length > 0) {
        return obj.tasks.slice(0, 5).map((t) => {
          const task = (t ?? {}) as {
            title?: unknown;
            objective?: unknown;
            doneCriteria?: unknown;
          };
          return {
            title: String(task.title ?? "").trim(),
            objective: String(task.objective ?? "").trim(),
            doneCriteria: Array.isArray(task.doneCriteria)
              ? task.doneCriteria.map(String)
              : [],
          };
        });
      }
    }
  } catch {
    // fail safe
  }
  return null;
}

// Mid-session research: real web search via the same server-side tool the
// session planner uses. Returns a tight factual summary the loop feeds back
// to the agent as context. Throws on failure — the caller (main.ts) falls
// back to the legacy DuckDuckGo instant-answer lookup.
const RESEARCH_SYSTEM_PROMPT = `You are the research arm of a live tech-support session. A coach is walking a non-expert user through a task on their computer and hit something it needs current facts for — often an exact error message or a product's current UI.

Search the web, then answer the query with a tight, factual summary under 250 words:
- Lead with the direct answer or the most likely fix.
- Use exact menu paths, button labels, and commands as they exist TODAY.
- If it's an error, list the top 1-3 causes with the fix for each, most likely first.
- Plain text only, no markdown headings, no preamble, no "based on my search".`;

export async function runWebResearch(query: string): Promise<string> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 1024,
    system: RESEARCH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: query }],
  };
  // web_search is a server-side tool; the SDK types here predate it (same
  // arrangement as getSessionPlan).
  (params as { tools?: unknown }).tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 3 },
  ];
  const resp = await client.messages.create(params);
  const text = extractText(resp);
  if (!text) throw new Error("web research returned no text");
  return text;
}

export async function getGoalEvaluation(args: {
  mode: AppMode;
  goal: string;
  completedSteps: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
}): Promise<GoalEvaluation> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });

  const stepsSummary = args.completedSteps.length > 0
    ? `Completed steps: ${args.completedSteps.join(", ")}`
    : "No steps recorded yet.";

  const recentConvo = args.conversation
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "AI"}: ${t.content}`)
    .join("\n");

  const frameContent = args.frames.slice(-2).map((f) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaTypeOf(f.dataUrl),
      data: f.dataUrl.replace(/^data:image\/\w+;base64,/, ""),
    },
  }));

  const userContent = [
    ...frameContent,
    {
      type: "text" as const,
      text: `Goal: "${args.goal}"\n\n${stepsSummary}\n\nRecent conversation:\n${recentConvo}\n\nDid the user successfully complete their goal based on the screen and conversation? Return JSON: {"achieved": true/false, "verdict": "2-3 sentence honest but encouraging assessment"}`,
    },
  ];

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: "You evaluate whether a user has completed their stated goal, based on screenshots and conversation history. Be honest, specific, and encouraging. Never invent progress that isn't visible.",
      messages: [{ role: "user", content: userContent }],
    });
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { achieved?: boolean; verdict?: string };
      if (typeof obj.achieved === "boolean" && obj.verdict) {
        return { achieved: obj.achieved, verdict: String(obj.verdict).trim() };
      }
    }
  } catch {
    // fail safe
  }
  return { achieved: false, verdict: "Couldn't evaluate at this time. Keep going — you're making progress!" };
}
