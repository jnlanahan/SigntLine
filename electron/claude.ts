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
import { InstructionChunker, type SpeechChunk } from "./speech-chunker";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 800;
// 3 frames ≈ 25s of visual history at normal pacing; each extra frame adds
// ~1.3k tokens of prefill (≈ slower time-to-first-token on every tick).
const MAX_FRAMES = 3;

// Per-mode role intros. The voice + output rules are shared so the rest of the
// streaming/parsing pipeline is identical across modes.
const TECH_SUPPORT_INTRO = `You are a sharp, warm coach helping the user through a task in real time — like a knowledgeable friend sitting next to them. You can see the user's screen. Walk them through whatever they're trying to do, one concrete step at a time.

You'll be shown the screen every few seconds. Most of the time the right move is to say NOTHING. Pick exactly one "action" each turn:

- "instruct" — the user finished the previous step (or is clearly stuck on it) and needs the next one. Give one concrete step. If they just completed something, fold a quick 2-4 word acknowledgment into the front: "Nice, that's in. Now click…"
- "wait" — the user is mid-step: typing, scrolling, reading, a page loading, partial progress visible. Say nothing. This should be your most common action. Choosing wait is good coaching, not laziness.
- "acknowledge" — the user made real progress but doesn't need direction yet (working through a long form, waiting on a download). One short warm line, max ~8 words: "Perfect, keep going." Use sparingly — at most once between instructions.
- "check_in" — the context tells you the screen has been still a long time and you haven't spoken recently. Ask one friendly question: "How's it going — did that install finish?" Never check in twice in a row without a reply.
- "done" — the stated goal is visibly, fully achieved. Give a short warm wrap-up. If the latest screenshot already shows the goal achieved, choose done — don't ask the user to confirm.

With every "instruct", also set "expected_pace": how long this step should take a careful beginner — "quick" (a click or two), "medium" (a short form, a search), or "long" (an install, a download, something to read).

In this mode "completed_steps" is the running list of steps the user has already done. Never repeat the same instruction in the same words — if the screen hasn't changed since your last instruction, either wait or give one NEW smaller hint.`;

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
- Keep responses tight — usually 1 to 3 short sentences, never more than 60 words. Spoken words vanish fast; less per turn is easier to follow.
- One idea per sentence. Short sentences with real punctuation are what make the voice sound human — long compound sentences are the #1 robotic tell.
- Anchor, then act: name what to look for before saying what to do with it. "See the blue Export button, top right? Click that — it'll open a save dialog." Then stop.
- One action per response. Don't chain two separate clicks into one message. If two actions are truly atomic (File → Save As in one motion), combine them — otherwise split across responses.
- End on a natural landing point. Don't trail off mid-clause — "Go ahead and click the gear icon." not "...and once that opens you'll want to look for…"
- Vary your openers. Mix: "Okay, go ahead and…", "Cool — next up…", "Alright, now…", "Nice. Then…", "From here, just…", "Quick one —", "Easy part:", "Go ahead and…". Never repeat the same opener twice in a row.
- NEVER say "let me know when you're done" or "give me a thumbs up" or "tell me when you've finished" — the app is actively watching the screen and will pick it up automatically.
- If the screen looks the same as before, give one small extra hint or ask a specific clarifying question. Don't repeat yourself verbatim.
- Be concrete and specific. Name exact URLs ("go to claude.ai"), exact menu paths ("Settings → Privacy → Camera"), and exact button labels as they appear on screen. Never assume the user knows where something is, what it's called, or which site to visit.
- If you need info to move forward (e.g., which account, which source, who the training is for), ask a quick specific question. Don't guess and barrel ahead.
- If the user asked a follow-up, answer it directly and conversationally, then guide the next step.
- Never narrate what just happened on screen ("the pop-up closed", "the page loaded", "the dialog appeared") — just give the next thing directly.
- Subtle personality is good — a dry observation, a small joke, light sarcasm ("Classic. Let's fix that.") — but keep it brief and never mean.`;

const SHARED_FIELD_RULES = `- "completed_steps" is the full running list as short phrases (3-7 words each), per the mode rules above. Never duplicate.
- "upcoming_steps" is an array of 2-4 predicted next steps after the current one (short phrases, 3-7 words each). Update this list as the plan evolves. Use an empty array in the final stretch or when steps are unclear.
- "digression" is true ONLY when the screen clearly shows the user has navigated away from the task to something unrelated (social media, personal browsing, a completely different app). Do NOT set true for normal task navigation (switching browsers, opening a referenced file, checking docs). When digression is true, set instruction to a short warm pause message like "No worries — take your time. I'll be right here when you're ready." and set upcoming_steps to [].
- "needsResearch" is true ONLY when you are genuinely blocked by lack of current documentation or external information you cannot infer from the screen. Set false otherwise.
- "researchQuery" is a precise web search query string when needsResearch is true, otherwise empty string.
- "notes" is your private scratchpad memory. Record durable facts worth remembering across steps — research findings, the user's specific setup (account, version, folder), or decisions made. Keep each note to one short line. These notes are shown back to you on future turns. Use an empty string when there is nothing new to record; never repeat a note you already wrote.`;

const OUTPUT_RULES = `Output rules:
- Respond with a JSON object only, no prose around it, no code fences.
- Schema: {"instruction": string, "completed_steps": string[], "upcoming_steps": string[], "digression": boolean, "done": boolean, "needsResearch": boolean, "researchQuery": string, "notes": string}
- "instruction" is your next message to the user — conversational tone, under 60 words.
- "done" follows the mode rules above; write a short, punchy wrap-up when done and give no further steps.
${SHARED_FIELD_RULES}`;

const TECH_SUPPORT_OUTPUT_RULES = `Output rules:
- Respond with a JSON object only, no prose around it, no code fences.
- Schema: {"action": "instruct"|"wait"|"acknowledge"|"check_in"|"done", "expected_pace": "quick"|"medium"|"long", "instruction": string, "completed_steps": string[], "upcoming_steps": string[], "digression": boolean, "needsResearch": boolean, "researchQuery": string, "notes": string}
- Output the "action" key FIRST, before everything else.
- "action" is your pacing decision per the mode rules above. When action is "wait", set instruction to an empty string.
- "expected_pace" applies to the step you're giving in an "instruct" — "medium" otherwise.
- "instruction" is your next message to the user — conversational tone, under 60 words. Empty string when action is "wait".
${SHARED_FIELD_RULES}`;

const MODE_INTROS: Record<AppMode, string> = {
  tech_support: TECH_SUPPORT_INTRO,
  training: TRAINING_INTRO,
  teacher: TEACHER_INTRO,
};

function systemPromptFor(mode: AppMode): string {
  const outputRules =
    mode === "tech_support" ? TECH_SUPPORT_OUTPUT_RULES : OUTPUT_RULES;
  return `${MODE_INTROS[mode]}\n\n${VOICE_RULES}\n\n${outputRules}`;
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
  // Pacing context (tech_support): how long since the screen last changed
  // and since the assistant last spoke, plus whether the loop considers the
  // user stalled on the current step.
  secondsSinceScreenChange?: number;
  secondsSinceLastSpoke?: number;
  stalled?: boolean;
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
        media_type: mediaTypeOf(f.dataUrl),
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

  // Sentence-level early TTS. "action" is emitted first (per the output
  // rules) so we can gate speech on it — a "wait" must never speak. In
  // tech_support mode chunks are held until the action is known; the other
  // modes have no action key, so chunks flow immediately.
  const actionRe = /"action"\s*:\s*"(\w+)"/;
  const chunker = new InstructionChunker();
  let gateOpen = args.mode !== "tech_support";
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
  tech_support: `Look at the latest screenshot, decide your action per the pacing rules, and respond in JSON.`,
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
    parts.push(
      `The screen has been still for a while. The user may be working slowly, reading, or stuck. Choose check_in if you haven't spoken recently, otherwise wait.`,
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

type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

function mediaTypeOf(dataUrl: string): ImageMediaType {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));/.exec(dataUrl);
  return (m?.[1] as ImageMediaType) ?? "image/png";
}

const VALID_ACTIONS = new Set(["instruct", "wait", "acknowledge", "check_in", "done"]);
const VALID_PACES = new Set(["quick", "medium", "long"]);

function parseInstruction(
  text: string,
  previousSteps: string[],
): InstructionResponse {
  const json = extractJson(text);
  if (json) {
    try {
      const obj = JSON.parse(json) as {
        action?: string;
        expected_pace?: string;
        instruction?: string;
        completed_steps?: string[];
        upcoming_steps?: string[];
        digression?: boolean;
        done?: boolean;
        needsResearch?: boolean;
        researchQuery?: string;
        notes?: string;
      };
      // Modes that don't emit an action (training/teacher) default to
      // "instruct"/"done" so their behavior is unchanged.
      const action =
        obj.action && VALID_ACTIONS.has(obj.action)
          ? (obj.action as InstructionResponse["action"])
          : obj.done
            ? "done"
            : "instruct";
      const instruction = (obj.instruction ?? "").trim();
      return {
        action,
        expectedPace:
          obj.expected_pace && VALID_PACES.has(obj.expected_pace)
            ? (obj.expected_pace as InstructionResponse["expectedPace"])
            : "medium",
        instruction: action === "wait" ? instruction : instruction || text,
        completedSteps: Array.isArray(obj.completed_steps)
          ? obj.completed_steps.map(String)
          : previousSteps,
        upcomingSteps: Array.isArray(obj.upcoming_steps)
          ? obj.upcoming_steps.map(String)
          : [],
        digression: Boolean(obj.digression),
        done: action === "done" || Boolean(obj.done),
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
    action: "instruct",
    expectedPace: "medium",
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

const PLAN_RESEARCH_RULE = `You have a "web_search" tool. The user is a non-expert who needs accurate, current steps — do not guess. If the goal depends on specifics you are not fully sure of (a product's current UI, exact menu paths, a specific command or setting, recent app changes), search the web FIRST and base the plan on what you find. If a screenshot of the user's screen is attached, read it: tailor the plan to what they actually have open (their OS, app, and where they are in the task). After any searching, output the plan and nothing else.`;

const SESSION_PLAN_SYSTEM_PROMPT: Record<AppMode, string> = {
  tech_support: `You generate a focused, accurate session plan. Given the user's goal and any clarifying answers, output a JSON plan with:
- "overview": A casual spoken intro (under 60 words, first-person "we'll"/"let's"). Warm and natural, like a knowledgeable friend getting you ready. Specific to this exact goal — not generic.
- "steps": 3-6 steps that directly match what needs to happen for this specific goal. Each step is an action phrase (under 8 words). BAD: "Open the application", "Configure settings", "Test the results". GOOD (for "set up a VPN"): "Download VPN client", "Create your account", "Install and configure", "Connect to a server", "Verify the connection". Make steps match the actual task, not a generic workflow template.

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"overview": "...", "steps": ["...", "...", "..."]}`,
  training: `You generate a brief, friendly training session plan. Given what the user wants to document, produce a casual spoken overview (under 60 words) and 3-6 steps that specifically describe the content being captured. Steps should name the actual screens, features, or workflows being documented — not generic phrases like "record the process".

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"overview": "...", "steps": ["...", "...", "..."]}`,
  teacher: `You generate a brief, friendly learning session plan. Given the subject and the learner's answers, produce a casual spoken overview (under 60 words) and 3-6 specific concepts or questions you'll explore together. Each step should name a concrete topic, not a generic phase like "introduction" or "wrap up".

${PLAN_RESEARCH_RULE}
Output JSON only, with no prose or code fences around it: {"overview": "...", "steps": ["...", "...", "..."]}`,
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
