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
import { InstructionChunker, type SpeechChunk } from "./speech-chunker";
import { extractJson, parseInstruction } from "./instruction-parse";
import { estimateCostUsd, normalizeUsage } from "./usage";
import { PLAN_RESEARCH_RULE, SHARED_FIELD_RULES, VOICE_RULES } from "./agents/shared";
import {
  techSupportSystemPrompt,
  TECH_SUPPORT_CLARIFICATION_PROMPT,
  TECH_SUPPORT_FOLLOW_UP_GUIDANCE,
  TECH_SUPPORT_NEXT_TURN_PROMPT,
  TECH_SUPPORT_PLAN_PROMPT,
  TECH_SUPPORT_SESSION_START_GUIDANCE,
  TECH_SUPPORT_STALLED_GUIDANCE,
} from "./agents/tech-support";
import {
  trainingSystemPrompt,
  TRAINING_CLARIFICATION_PROMPT,
  TRAINING_FOLLOW_UP_GUIDANCE,
  TRAINING_NEXT_TURN_PROMPT,
  TRAINING_PLAN_PROMPT,
  TRAINING_SESSION_START_GUIDANCE,
  TRAINING_STALLED_GUIDANCE,
} from "./agents/training";
import {
  teacherSystemPrompt,
  TEACHER_CLARIFICATION_PROMPT,
  TEACHER_FOLLOW_UP_GUIDANCE,
  TEACHER_NEXT_TURN_PROMPT,
  TEACHER_PLAN_PROMPT,
  TEACHER_SESSION_START_GUIDANCE,
  TEACHER_STALLED_GUIDANCE,
} from "./agents/teacher";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;
// Previous frame + latest frame. Each frame costs ~1.2k tokens of prefill,
// which lands directly on time-to-first-token — i.e. on how long the user
// waits to hear anything. A third frame was measurably slower and added
// little: "what changed" is already answered by the before/after pair, and
// everything older is better carried by completed_steps, the agent's notes,
// and the explicit "screen last changed Ns ago" timing line.
const MAX_FRAMES = 2;

// Every mode now has its own agent module, and every mode declares an
// "action" each turn. That last part matters: a mode without one has no way
// to stay silent, so a turn it intended as "say nothing" parsed as "speak"
// and fell back to reading the raw JSON aloud.
function systemPromptFor(mode: AppMode): string {
  switch (mode) {
    case "training":
      return trainingSystemPrompt();
    case "teacher":
      return teacherSystemPrompt();
    default:
      return techSupportSystemPrompt();
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("Anthropic API key is not configured");
    this.name = "MissingApiKeyError";
  }
}

export class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Rate limited; retry after ${retryAfterSec}s`);
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

export interface NextInstructionArgs {
  mode: AppMode;
  goal: string;
  completedSteps: string[];
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

export async function getNextInstruction(
  args: NextInstructionArgs,
  // Optional: called with each completed sentence of the "instruction" field
  // while the response is still streaming — lets the caller start TTS on the
  // first sentence instead of waiting for the full JSON. Never fires for a
  // "wait" action.
  onSpeechChunk?: (chunk: SpeechChunk) => void,
): Promise<InstructionResponse> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  // When the screen hasn't changed since the last look, the two frames are
  // near-identical and the older one carries no information — send just the
  // latest. This is the stall/check-in path, which would otherwise pay full
  // image cost to show the model the same picture twice.
  const frameBudget = args.screenChanged === false ? 1 : MAX_FRAMES;
  const frames = args.frames.slice(-frameBudget);

  const userBlocks: Array<
    Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam
  > = [];

  userBlocks.push({
    type: "text",
    text: buildContextHeader(args, frames.length),
  });

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const isLatest = i === frames.length - 1;
    // Only the latest frame needs to be sharp enough to read a button label.
    // Earlier frames are context for "what changed" and are sent small — a
    // ~4x token saving on every tick that attaches history.
    const dataUrl = isLatest ? f.dataUrl : toContextResolution(f.dataUrl);
    const label = isLatest
      ? "Latest screenshot (most recent, full resolution):"
      : `Screenshot ${i + 1} of ${frames.length} (earlier, reduced resolution — for comparison only):`;
    userBlocks.push({ type: "text", text: label });
    userBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaTypeOf(dataUrl),
        data: stripDataUrlPrefix(dataUrl),
      },
    });
  }

  if (args.followUp && args.followUp.trim().length > 0) {
    userBlocks.push({
      type: "text",
      text: `User follow-up: ${args.followUp.trim()}`,
    });
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    ...convertHistory(args.conversation),
    { role: "user", content: userBlocks },
  ];

  // Sentence-level early TTS. "action" is emitted first (per every mode's
  // output rules) so speech can be gated on it — a "wait" must never speak.
  // Chunks are held until the action is known, in EVERY mode: the modes that
  // used to stream ungated would happily start reading a silent turn out loud
  // before the response revealed it was meant to be silent.
  const actionRe = /"action"\s*:\s*"(\w+)"/;
  const chunker = new InstructionChunker();
  let gateOpen = false;
  let gateClosed = false; // action === "wait" — drop everything
  const held: SpeechChunk[] = [];
  const emitChunks = (chunks: SpeechChunk[]) => {
    if (gateClosed || !onSpeechChunk) return;
    for (const c of chunks) {
      if (gateOpen) onSpeechChunk(c);
      else held.push(c);
    }
  };
  const openGate = () => {
    gateOpen = true;
    if (onSpeechChunk) for (const c of held.splice(0)) onSpeechChunk(c);
  };

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Cache the (byte-identical across ticks) system prompt — cuts
      // time-to-first-token and cost on every poll. Cast because the SDK
      // types in use predate GA prompt caching; the API accepts it.
      system: [
        {
          type: "text",
          text: systemPromptFor(args.mode),
          cache_control: { type: "ephemeral" },
        } as unknown as Anthropic.Messages.TextBlockParam,
      ],
      messages,
    });

    let accumulated = "";
    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        accumulated += chunk.delta.text;
        if (!gateOpen && !gateClosed) {
          const m = actionRe.exec(accumulated);
          if (m) {
            if (m[1] === "wait") {
              gateClosed = true;
              held.length = 0;
            } else {
              openGate();
            }
          }
        }
        emitChunks(chunker.push(accumulated));
      }
    }
    // Stream done. If the action never appeared (schema drift), speak rather
    // than stay silent — matching parseInstruction's "instruct" default.
    if (!gateOpen && !gateClosed) openGate();
    emitChunks(chunker.finish());

    const resp = await stream.finalMessage();
    const text = extractText(resp);
    const parsed = parseInstruction(text, args.completedSteps);
    // Attach token accounting after parsing so instruction-parse.ts stays a
    // pure, independently-testable module.
    const usage = normalizeUsage(resp.usage);
    return {
      ...parsed,
      usage,
      model: MODEL,
      costUsd: estimateCostUsd(MODEL, usage),
    };
  } catch (err: unknown) {
    // Anthropic SDK uses status codes on APIError instances.
    const anyErr = err as { status?: number; headers?: Record<string, string> };
    if (anyErr && anyErr.status === 429) {
      const retryAfter = Number(
        anyErr.headers?.["retry-after"] ?? anyErr.headers?.["Retry-After"] ?? 30,
      );
      throw new RateLimitError(Number.isFinite(retryAfter) ? retryAfter : 30);
    }
    throw err;
  }
}

const NEXT_TURN_PROMPT: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_NEXT_TURN_PROMPT,
  training: TRAINING_NEXT_TURN_PROMPT,
  teacher: TEACHER_NEXT_TURN_PROMPT,
};

const STALLED_GUIDANCE: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_STALLED_GUIDANCE,
  training: TRAINING_STALLED_GUIDANCE,
  teacher: TEACHER_STALLED_GUIDANCE,
};

const SESSION_START_GUIDANCE: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_SESSION_START_GUIDANCE,
  training: TRAINING_SESSION_START_GUIDANCE,
  teacher: TEACHER_SESSION_START_GUIDANCE,
};

const FOLLOW_UP_GUIDANCE: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_FOLLOW_UP_GUIDANCE,
  training: TRAINING_FOLLOW_UP_GUIDANCE,
  teacher: TEACHER_FOLLOW_UP_GUIDANCE,
};

function buildContextHeader(args: NextInstructionArgs, frameCount: number): string {
  const stepsList =
    args.completedSteps.length === 0
      ? "(none yet)"
      : args.completedSteps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const parts = [
    `Original goal: ${args.goal}`,
    `Steps already completed:\n${stepsList}`,
    `Attached screenshots: ${frameCount} (oldest to newest).`,
  ];
  if (args.clarificationContext && args.clarificationContext.trim().length > 0) {
    parts.push(`Answers to clarifying questions:\n${args.clarificationContext}`);
  }
  if (args.uploadedContext && args.uploadedContext.trim().length > 0) {
    parts.push(`Reference material the user attached:\n${args.uploadedContext.trim()}`);
  }
  if (args.recalledMemory && args.recalledMemory.trim().length > 0) {
    parts.push(args.recalledMemory.trim());
  }
  if (args.agentNotes && args.agentNotes.length > 0) {
    parts.push(
      `Your notes so far (memory you recorded on earlier turns):\n` +
        args.agentNotes.map((n) => `- ${n}`).join("\n"),
    );
  }
  const lastAssistant = [...args.conversation]
    .reverse()
    .find((t) => t.role === "assistant");
  if (lastAssistant) {
    parts.push(
      `Your previous instruction was: "${lastAssistant.content.trim()}".\n` +
        `If the latest screenshot shows the user has NOT acted on it yet, do not repeat the same sentence — either give a small additional hint or ask a brief clarifying question instead.`,
    );
  }
  if (args.lastExpectedResult && args.lastExpectedResult.trim().length > 0) {
    parts.push(
      `Expected result of that instruction: "${args.lastExpectedResult.trim()}". Check the latest screenshot for it before advancing (verify rules).`,
    );
  }
  if (
    args.secondsSinceScreenChange !== undefined ||
    args.secondsSinceLastSpoke !== undefined
  ) {
    const timing: string[] = [];
    if (args.secondsSinceScreenChange !== undefined) {
      timing.push(`screen last changed ${args.secondsSinceScreenChange}s ago`);
    }
    if (args.secondsSinceLastSpoke !== undefined) {
      timing.push(`you last spoke ${args.secondsSinceLastSpoke}s ago`);
    }
    parts.push(`Timing: ${timing.join("; ")}.`);
  }
  if (args.stalled) {
    parts.push(STALLED_GUIDANCE[args.mode]);
  }
  if (args.sessionJustStarted) {
    parts.push(SESSION_START_GUIDANCE[args.mode]);
  }
  if (args.followUp && args.followUp.trim().length > 0) {
    parts.push(FOLLOW_UP_GUIDANCE[args.mode]);
  }
  parts.push(NEXT_TURN_PROMPT[args.mode]);
  return parts.join("\n\n");
}

function convertHistory(
  turns: ConversationTurn[],
): Anthropic.Messages.MessageParam[] {
  // Keep history bounded; vision frames are already attached separately so the
  // historical turns are text-only summaries.
  return turns.slice(-10).map((t) => ({
    role: t.role,
    content: t.content,
  }));
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

const CLARIFICATION_SYSTEM_PROMPT: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_CLARIFICATION_PROMPT,
  training: TRAINING_CLARIFICATION_PROMPT,
  teacher: TEACHER_CLARIFICATION_PROMPT,
};

export async function getClarifications(args: {
  mode: AppMode;
  goal: string;
}): Promise<ClarificationResponse> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: CLARIFICATION_SYSTEM_PROMPT[args.mode],
      messages: [{ role: "user", content: `Task: ${args.goal}` }],
    });
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { questions?: unknown };
      if (Array.isArray(obj.questions)) {
        return {
          questions: obj.questions.slice(0, 3).map((q: unknown) => {
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

const SESSION_PLAN_SYSTEM_PROMPT: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_PLAN_PROMPT,
  training: TRAINING_PLAN_PROMPT,
  teacher: TEACHER_PLAN_PROMPT,
};

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
      system: SESSION_PLAN_SYSTEM_PROMPT[args.mode],
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
