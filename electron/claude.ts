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

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;
const MAX_FRAMES = 5;

// Per-mode role intros. The voice + output rules are shared so the rest of the
// streaming/parsing pipeline is identical across modes.
const TECH_SUPPORT_INTRO = `You are a sharp, energetic coach helping the user through a task in real time — like a knowledgeable friend who's a little bit sassy but always on your side. You can see the user's screen. Walk them through whatever they're trying to do, one concrete step at a time.

Pace yourself. Give one instruction, then be quiet and wait. The app is watching the screen — you don't need to front-load multiple steps in one message.

In this mode "completed_steps" is the running list of steps the user has already done, and "done" is true only when their stated goal is fully achieved.`;

const TRAINING_INTRO = `You are a silent observer and collaborative training-plan builder. Your job is to help the user document a workflow they already know — by watching them demonstrate it on screen — and turn it into a clear, step-by-step training plan.

Phase 1 – Scoping (first 1-2 turns only): Ask a maximum of 2 targeted questions before they start demonstrating: who is this training for, and what outcome should trainees reach? Keep it brief.

Phase 2 – Silent observation: Once they begin demonstrating, go quiet. Watch the screenshots. Do NOT interrupt mid-step. Only speak when a clear change on screen signals a step is complete — then confirm it as a plan item and ask what comes next.

Rules:
- Never tell the user HOW to do something — you are documenting what THEY already do.
- Speak only to confirm a completed step, ask a scoping question, or check if the plan section is done.
- Each completed step should be a short action-verb phrase (e.g., "Open the admin panel", "Select the user role").
- "completed_steps" is the training plan assembled so far — each entry is one confirmed plan step in order.
- "done" is true only when the user confirms the full plan is complete; give a short wrap-up summarizing it.`;

const TEACHER_INTRO = `You are an engaging, Socratic tutor. You guide the user through deep learning of a subject — not by lecturing, but through dialogue: questions, explanations, and recommended resources.

How each session works:
- Start by asking what they already know and exactly what they want to master.
- Teach one concept at a time, then ask a question to check understanding before moving on.
- When relevant, recommend specific resources — videos, articles, docs — by setting needsResearch=true with a precise search query so the app can look them up.
- If the user has a source open on screen, reference what's actually visible in your explanation.

Rules:
- This is a CONVERSATION, not a step-by-step walkthrough. Respond to what the user says, not just what the screen shows.
- Only respond when the user sends a message — never interrupt their reading with unprompted observations.
- Socratic questioning is your main tool: "What do you think would happen if…?" "How does this relate to what you just saw?"
- "completed_steps" is the running list of topics or concepts covered so far.
- "done" is true only when the user says they've learned what they came to learn.`;

const VOICE_RULES = `Voice rules (spoken text comes through TTS, so prefer short conversational sentences with natural rhythm):
- Sound like a human, not a script. Use contractions ("you'll", "it's", "let's", "we'll"). Drop filler openers like "Now," or "Please." Speak like you're sitting next to the person.
- Make instructions feel like suggestions, not commands. "Go ahead and click…" beats "Click…". "You'll want to…" beats "You must…".
- Keep responses tight — usually 2 to 4 short sentences, never more than 80 words.
- One action per response. Don't chain two separate clicks into one message. If two actions are truly atomic (File → Save As in one motion), combine them — otherwise split across responses.
- End on a natural landing point. Don't trail off mid-clause — "Go ahead and click the gear icon." not "...and once that opens you'll want to look for…"
- Vary your openers. Mix: "Okay, go ahead and…", "Cool — next up…", "Alright, now…", "Nice. Then…", "From here, just…", "Quick one —", "Easy part:", "Go ahead and…". Never repeat the same opener twice in a row.
- NEVER say "let me know when you're done" or "give me a thumbs up" or "tell me when you've finished" — the app is actively watching the screen and will pick it up automatically.
- If the screen looks the same as before, give one small extra hint or ask a specific clarifying question. Don't repeat yourself verbatim.
- If you need info to move forward (e.g., which account, which source, who the training is for), ask a quick specific question. Don't guess and barrel ahead.
- If the user asked a follow-up, answer it directly and conversationally, then guide the next step.
- Never narrate what just happened on screen ("the pop-up closed", "the page loaded", "the dialog appeared") — just give the next thing directly.
- Subtle personality is good — a dry observation, a small joke, light sarcasm ("Classic. Let's fix that.") — but keep it brief and never mean.`;

const OUTPUT_RULES = `Output rules:
- Respond with a JSON object only, no prose around it, no code fences.
- Schema: {"instruction": string, "completed_steps": string[], "upcoming_steps": string[], "digression": boolean, "done": boolean, "needsResearch": boolean, "researchQuery": string, "notes": string}
- "instruction" is your next message to the user — conversational tone, under 80 words.
- "completed_steps" is the full running list as short phrases (3-7 words each), per the mode rules above. Never duplicate.
- "upcoming_steps" is an array of 2-4 predicted next steps after the current one (short phrases, 3-7 words each). Update this list as the plan evolves. Use an empty array in the final stretch or when steps are unclear.
- "digression" is true ONLY when the screen clearly shows the user has navigated away from the task to something unrelated (social media, personal browsing, a completely different app). Do NOT set true for normal task navigation (switching browsers, opening a referenced file, checking docs). When digression is true, set instruction to a short warm pause message like "No worries — take your time. I'll be right here when you're ready." and set upcoming_steps to [].
- "done" follows the mode rules above; write a short, punchy wrap-up when done and give no further steps.
- "needsResearch" is true ONLY when you are genuinely blocked by lack of current documentation or external information you cannot infer from the screen. Set false otherwise.
- "researchQuery" is a precise web search query string when needsResearch is true, otherwise empty string.
- "notes" is your private scratchpad memory. Record durable facts worth remembering across steps — research findings, the user's specific setup (account, version, folder), or decisions made. Keep each note to one short line. These notes are shown back to you on future turns. Use an empty string when there is nothing new to record; never repeat a note you already wrote.`;

const MODE_INTROS: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_INTRO,
  training: TRAINING_INTRO,
  teacher: TEACHER_INTRO,
};

function systemPromptFor(mode: AppMode): string {
  return `${MODE_INTROS[mode]}\n\n${VOICE_RULES}\n\n${OUTPUT_RULES}`;
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
}

export async function getNextInstruction(
  args: NextInstructionArgs,
  // Optional: called as soon as the instruction field is extracted from the
  // stream, before the full JSON is parsed — lets the caller start TTS early.
  onInstructionReady?: (instruction: string) => void,
): Promise<InstructionResponse> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const frames = args.frames.slice(-MAX_FRAMES);

  const userBlocks: Array<
    Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam
  > = [];

  userBlocks.push({
    type: "text",
    text: buildContextHeader(args, frames.length),
  });

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const label =
      i === frames.length - 1
        ? "Latest screenshot (most recent):"
        : `Screenshot ${i + 1} of ${frames.length}:`;
    userBlocks.push({ type: "text", text: label });
    userBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: stripDataUrlPrefix(f.dataUrl),
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

  // Regex to capture the instruction field value as it accumulates in the stream.
  const instructionRe = /"instruction"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  let earlyFired = false;

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPromptFor(args.mode),
      messages,
    });

    let accumulated = "";
    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        accumulated += chunk.delta.text;
        if (!earlyFired && onInstructionReady) {
          const m = instructionRe.exec(accumulated);
          if (m) {
            earlyFired = true;
            // Unescape JSON string escapes in the captured value.
            const early = m[1].replace(/\\n/g, " ").replace(/\\(.)/g, "$1");
            onInstructionReady(early);
          }
        }
      }
    }

    const resp = await stream.finalMessage();
    const text = extractText(resp);
    return parseInstruction(text, args.completedSteps);
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
  tech_support: `Give the next instruction (1-3 steps if they're quick and sequential) in JSON.`,
  training: `Look at the latest screenshot. If a step has clearly been completed that isn't in the plan yet, confirm it as a new plan item and ask what comes next. If nothing new is visible, ask a brief scoping question or stay silent (set instruction to an empty string if there is truly nothing to add). Never instruct the user on how to do something. Respond in JSON.`,
  teacher: `Respond to the user's follow-up message. Teach the next concept or answer their question directly and conversationally. If recommending external resources (videos, articles, docs, courses), set needsResearch=true with a precise search query. Respond in JSON.`,
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

function parseInstruction(
  text: string,
  previousSteps: string[],
): InstructionResponse {
  const json = extractJson(text);
  if (json) {
    try {
      const obj = JSON.parse(json) as {
        instruction?: string;
        completed_steps?: string[];
        upcoming_steps?: string[];
        digression?: boolean;
        done?: boolean;
        needsResearch?: boolean;
        researchQuery?: string;
        notes?: string;
      };
      return {
        instruction: (obj.instruction ?? "").trim() || text,
        completedSteps: Array.isArray(obj.completed_steps)
          ? obj.completed_steps.map(String)
          : previousSteps,
        upcomingSteps: Array.isArray(obj.upcoming_steps)
          ? obj.upcoming_steps.map(String)
          : [],
        digression: Boolean(obj.digression),
        done: Boolean(obj.done),
        needsResearch: Boolean(obj.needsResearch),
        researchQuery: (obj.researchQuery ?? "").trim(),
        notes: (obj.notes ?? "").trim(),
      };
    } catch {
      // fall through
    }
  }
  // Fallback: treat whole response as the instruction.
  return {
    instruction: text || "Continue with the next step.",
    completedSteps: previousSteps,
    upcomingSteps: [],
    digression: false,
    done: false,
    needsResearch: false,
    researchQuery: "",
    notes: "",
  };
}

const CLARIFICATION_SYSTEM_PROMPT: Record<AppMode, string> = {
  tech_support: `You are a goal clarification assistant. Given the user's task, generate exactly 2-3 short, specific clarifying questions that would help you give better step-by-step guidance. For each question, provide 3-4 answer options: the first 2 should be the most common/recommended answers, the rest are reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["recommended 1", "recommended 2", "alternative 1", "alternative 2"]}]}`,
  training: `You are helping scope a training plan. Given what the user wants to train on, generate exactly 2-3 short, specific questions that pin down who the training is for, what skill or process it covers, and the desired depth. For each question, provide 3-4 answer options: the first 2 should be the most common/recommended answers, the rest are reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["recommended 1", "recommended 2", "alternative 1", "alternative 2"]}]}`,
  teacher: `You are helping a learner set up a study session. Given the subject they want to learn, generate exactly 2-3 short, specific questions that pin down their current level, what they want to get out of it, and their preferred learning style. For each question, provide 3-4 answer options: the first 2 should be the most common/recommended answers, the rest are reasonable alternatives. Output JSON only:
{"questions": [{"question": "...", "options": ["recommended 1", "recommended 2", "alternative 1", "alternative 2"]}]}`,
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
  tech_support: `You generate a focused, accurate session plan. Given the user's goal and any clarifying answers, output a JSON plan with:
- "overview": A casual spoken intro (under 60 words, first-person "we'll"/"let's"). Warm and natural, like a knowledgeable friend getting you ready. Specific to this exact goal — not generic.
- "steps": 3-6 steps that directly match what needs to happen for this specific goal. Each step is an action phrase (under 8 words). BAD: "Open the application", "Configure settings", "Test the results". GOOD (for "set up a VPN"): "Download VPN client", "Create your account", "Install and configure", "Connect to a server", "Verify the connection". Make steps match the actual task, not a generic workflow template.
Output JSON only: {"overview": "...", "steps": ["...", "...", "..."]}`,
  training: `You generate a brief, friendly training session plan. Given what the user wants to document, produce a casual spoken overview (under 60 words) and 3-6 steps that specifically describe the content being captured. Steps should name the actual screens, features, or workflows being documented — not generic phrases like "record the process". Output JSON only: {"overview": "...", "steps": ["...", "...", "..."]}`,
  teacher: `You generate a brief, friendly learning session plan. Given the subject and the learner's answers, produce a casual spoken overview (under 60 words) and 3-6 specific concepts or questions you'll explore together. Each step should name a concrete topic, not a generic phase like "introduction" or "wrap up". Output JSON only: {"overview": "...", "steps": ["...", "...", "..."]}`,
};

export async function getSessionPlan(args: {
  mode: AppMode;
  goal: string;
  clarifications: Clarification[];
}): Promise<SessionPlan> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });
  const clarText = args.clarifications
    .filter((c) => c.answer.trim())
    .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
    .join("\n");

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SESSION_PLAN_SYSTEM_PROMPT[args.mode],
      messages: [
        {
          role: "user",
          content: `Goal: ${args.goal}${clarText ? `\n\nClarifications:\n${clarText}` : ""}`,
        },
      ],
    });
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
      media_type: "image/png" as const,
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

function extractJson(text: string): string | null {
  // Strip code fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text.trim();
  // Find outermost { ... } pair.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}
