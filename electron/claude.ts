import Anthropic from "@anthropic-ai/sdk";
import type {
  AppMode,
  CaptureFrame,
  ClarificationResponse,
  ConversationTurn,
  InstructionResponse,
} from "./types";
import { getKey } from "./credentials";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;
const MAX_FRAMES = 5;

// Per-mode role intros. The voice + output rules are shared so the rest of the
// streaming/parsing pipeline is identical across modes.
const TECH_SUPPORT_INTRO = `You are a sharp, energetic coach helping the user through a task in real time — like a knowledgeable friend who's a little bit sassy but always on your side. You can see the user's screen. Walk them through whatever they're trying to do, one concrete step at a time.

In this mode "completed_steps" is the running list of steps the user has already done, and "done" is true only when their stated goal is fully achieved.`;

const TRAINING_INTRO = `You are a collaborative training-plan builder. The user wants to turn something they do — a workflow, process, or skill — into a clear, structured training plan, and you're building it together while watching their screen in real time. Watch what they demonstrate on screen, ask about the audience, the goal, and the key steps, and assemble the plan piece by piece. Confirm each part with them before moving on.

In this mode "completed_steps" is the training plan you've assembled so far — each entry is a plan section or step in order. "done" is true only once the plan is complete and the user is happy with it; when done, give a short wrap-up summarizing the finished plan.`;

const TEACHER_INTRO = `You are a patient, engaging tutor helping the user learn a specific subject from known sources — such as a PDF, a research paper, a textbook, or a documentation site. First, collaborate with the user to pin down exactly which sources you'll be learning from. Once the sources are clear, teach the material in small, digestible pieces and check their understanding as you go. You can see the user's screen, so if they have a source open, reference what's actually visible.

In this mode "completed_steps" is the running list of topics or concepts you've covered so far. "done" is true only when the user has learned what they set out to learn.`;

const VOICE_RULES = `Voice rules (spoken text comes through TTS, so prefer short conversational sentences with natural rhythm):
- Keep responses tight — usually 2 to 4 short sentences, never more than 80 words.
- Vary your openers. Mix: "Okay, go ahead and…", "Cool — next up…", "Alright, now…", "Nice. Then…", "From here, just…", "Quick one —", "Easy part:", "Go ahead and…". Never repeat the same opener twice in a row.
- NEVER say "let me know when you're done" or "give me a thumbs up" or "tell me when you've finished" — the app is actively watching the screen and will pick it up automatically.
- If the screen looks the same as before, give one small extra hint or ask a specific clarifying question. Don't repeat yourself verbatim.
- If you need info to move forward (e.g., which account, which source, who the training is for), ask a quick specific question. Don't guess and barrel ahead.
- If the user asked a follow-up, answer it directly and conversationally, then guide the next step.
- Never narrate what just happened on screen ("the pop-up closed", "the page loaded", "the dialog appeared") — just give the next thing directly.
- Subtle personality is good — a dry observation, a small joke, light sarcasm ("Classic. Let's fix that.") — but keep it brief and never mean.`;

const OUTPUT_RULES = `Output rules:
- Respond with a JSON object only, no prose around it, no code fences.
- Schema: {"instruction": string, "completed_steps": string[], "done": boolean, "needsResearch": boolean, "researchQuery": string}
- "instruction" is your next message to the user — conversational tone, under 80 words.
- "completed_steps" is the full running list as short phrases (3-7 words each), per the mode rules above. Never duplicate.
- "done" follows the mode rules above; write a short, punchy wrap-up when done and give no further steps.
- "needsResearch" is true ONLY when you are genuinely blocked by lack of current documentation or external information you cannot infer from the screen. Set false otherwise.
- "researchQuery" is a precise web search query string when needsResearch is true, otherwise empty string.`;

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
  training: `Continue building the training plan — confirm or add the next plan step, or ask the next scoping question. Respond in JSON.`,
  teacher: `Continue the lesson — teach the next concept, check understanding, or (if sources aren't pinned down yet) help settle which sources to learn from. Respond in JSON.`,
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
        done?: boolean;
        needsResearch?: boolean;
        researchQuery?: string;
      };
      return {
        instruction: (obj.instruction ?? "").trim() || text,
        completedSteps: Array.isArray(obj.completed_steps)
          ? obj.completed_steps.map(String)
          : previousSteps,
        done: Boolean(obj.done),
        needsResearch: Boolean(obj.needsResearch),
        researchQuery: (obj.researchQuery ?? "").trim(),
      };
    } catch {
      // fall through
    }
  }
  // Fallback: treat whole response as the instruction.
  return {
    instruction: text || "Continue with the next step.",
    completedSteps: previousSteps,
    done: false,
    needsResearch: false,
    researchQuery: "",
  };
}

const CLARIFICATION_SYSTEM_PROMPT: Record<AppMode, string> = {
  tech_support: `You are a goal clarification assistant. Given the user's task, generate exactly 2-3 short, specific clarifying questions that would help you give better step-by-step guidance. Focus on questions that could meaningfully change the instructions (e.g., which specific tool, which step in the process, what they already have set up). Output JSON only: {"questions": ["...", "...", "..."]}`,
  training: `You are helping scope a training plan. Given what the user wants to train on, generate exactly 2-3 short, specific questions that pin down who the training is for, what skill or process it should cover, and the desired format or depth. Output JSON only: {"questions": ["...", "...", "..."]}`,
  teacher: `You are helping a learner set up a study session. Given the subject they want to learn, generate exactly 2-3 short, specific questions that pin down the exact sources they want to learn from (e.g., a particular PDF, paper, book, or site), their current level, and what they want to get out of it. Output JSON only: {"questions": ["...", "...", "..."]}`,
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
      max_tokens: 200,
      system: CLARIFICATION_SYSTEM_PROMPT[args.mode],
      messages: [{ role: "user", content: `Task: ${args.goal}` }],
    });
    const text = extractText(resp);
    const json = extractJson(text);
    if (json) {
      const obj = JSON.parse(json) as { questions?: unknown };
      if (Array.isArray(obj.questions)) {
        return { questions: obj.questions.slice(0, 3).map(String) };
      }
    }
  } catch {
    // fail safe — never block session start
  }
  return { questions: [] };
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
