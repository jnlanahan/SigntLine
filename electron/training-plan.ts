// Pure curriculum bookkeeping for Training mode.
//
// Everything here is a plain function over the TrainingPlan shape — no
// Electron, no fs, no API calls — so both processes can import it and the
// whole progression model (cursor advancement, module rollover, mistake
// memory, session-end summaries) is unit-testable.
//
// Mutating functions return new objects (copy-on-write along the touched
// path); callers persist the result via the plans store.

import { keywords } from "./memory-rank";
import type {
  TaskFeedback,
  TrainingModule,
  TrainingPlan,
  TrainingTask,
} from "./db/schema";

/** Recurring-mistake memory stays short enough to ride every prompt. */
export const MAX_MISTAKE_PATTERNS = 8;
// A journal entry per session; even a months-long program stays tiny.
const MAX_JOURNAL_ENTRIES = 200;
const MAX_DONE_CRITERIA = 4;

// ── Reading the cursor ──

export function currentModule(plan: TrainingPlan): TrainingModule | null {
  return plan.modules[plan.cursor.module] ?? null;
}

export function currentTask(plan: TrainingPlan): TrainingTask | null {
  return currentModule(plan)?.tasks[plan.cursor.task] ?? null;
}

export function taskCounts(plan: TrainingPlan): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const m of plan.modules) {
    for (const t of m.tasks) {
      total++;
      if (t.status === "completed") done++;
    }
  }
  return { done, total };
}

/** Fraction of tasks completed, 0..1. Drives the progress bar. */
export function planProgress(plan: TrainingPlan): number {
  const { done, total } = taskCounts(plan);
  return total === 0 ? 0 : done / total;
}

export function planComplete(plan: TrainingPlan): boolean {
  return (
    plan.modules.length > 0 &&
    plan.modules.every((m) => m.status === "completed")
  );
}

// ── Building a plan from the outline call ──

export interface OutlineModule {
  title: string;
  summary: string;
  taskTitles: string[];
}

export interface CurriculumOutline {
  title: string;
  overview: string;
  learnerProfile: string;
  modules: OutlineModule[];
}

export interface ModuleTaskDetail {
  title: string;
  objective: string;
  doneCriteria: string[];
}

export function buildPlanFromOutline(
  outline: CurriculumOutline,
  goal: string,
  args: { id: string; now: number; idFor: (prefix: string) => string },
): TrainingPlan {
  const modules: TrainingModule[] = outline.modules
    .filter((m) => m.title.trim().length > 0 && m.taskTitles.length > 0)
    .map((m) => ({
      id: args.idFor("mod"),
      title: m.title.trim(),
      summary: m.summary.trim(),
      detailed: false,
      status: "not_started",
      tasks: m.taskTitles
        .filter((t) => t.trim().length > 0)
        .map((t) => ({
          id: args.idFor("task"),
          title: t.trim(),
          objective: null,
          doneCriteria: [],
          status: "not_started",
          feedback: [],
          completedAt: null,
        })),
    }));
  return {
    id: args.id,
    userId: null,
    title: outline.title.trim() || goal,
    goal,
    learnerProfile: outline.learnerProfile.trim(),
    overview: outline.overview.trim(),
    modules,
    cursor: { module: 0, task: 0 },
    mistakePatterns: [],
    whereWeLeftOff: "",
    journal: [],
    createdAt: args.now,
    updatedAt: args.now,
    sourceSessionId: null,
    runCount: 0,
  };
}

/**
 * Fill in objectives and done-criteria for one module. Task list is replaced
 * wholesale — detailing happens before a module starts, so there is no
 * completed work to preserve. A detail result with no tasks leaves the plan
 * unchanged rather than emptying the module.
 */
export function applyModuleDetail(
  plan: TrainingPlan,
  moduleIndex: number,
  tasks: readonly ModuleTaskDetail[],
  args: { now: number; idFor: (prefix: string) => string },
): TrainingPlan {
  const module = plan.modules[moduleIndex];
  const usable = tasks.filter(
    (t) => t.title.trim().length > 0 && t.objective.trim().length > 0,
  );
  if (!module || usable.length === 0) return plan;
  if (module.tasks.some((t) => t.status === "completed")) return plan;
  const nextModule: TrainingModule = {
    ...module,
    detailed: true,
    tasks: usable.map((t) => ({
      id: args.idFor("task"),
      title: t.title.trim(),
      objective: t.objective.trim(),
      doneCriteria: t.doneCriteria
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .slice(0, MAX_DONE_CRITERIA),
      status: "not_started",
      feedback: [],
      completedAt: null,
    })),
  };
  return {
    ...plan,
    modules: plan.modules.map((m, i) => (i === moduleIndex ? nextModule : m)),
    // Detailing can shrink a module below the old cursor position.
    cursor:
      moduleIndex === plan.cursor.module
        ? { module: moduleIndex, task: Math.min(plan.cursor.task, nextModule.tasks.length - 1) }
        : plan.cursor,
    updatedAt: args.now,
  };
}

// ── Progress ──

/** Session start against a plan: count the run, mark the cursor in progress. */
export function beginRun(plan: TrainingPlan, now: number): TrainingPlan {
  const next = withStatus(plan, "in_progress", now);
  return { ...next, runCount: plan.runCount + 1 };
}

function withStatus(
  plan: TrainingPlan,
  status: "in_progress",
  now: number,
): TrainingPlan {
  const module = currentModule(plan);
  const task = currentTask(plan);
  if (!module || !task || task.status === "completed") return plan;
  return {
    ...plan,
    modules: plan.modules.map((m, mi) =>
      mi !== plan.cursor.module
        ? m
        : {
            ...m,
            status: m.status === "completed" ? m.status : status,
            tasks: m.tasks.map((t, ti) =>
              ti !== plan.cursor.task || t.status === "completed"
                ? t
                : { ...t, status },
            ),
          },
    ),
    updatedAt: now,
  };
}

export interface VerdictResult {
  plan: TrainingPlan;
  /** A pass rolled into a new module — caller should detail it if needed. */
  enteredNewModule: boolean;
  planCompleted: boolean;
}

/**
 * Apply a check-my-work verdict to the current task. `pass` completes the
 * task and advances the cursor (rolling the module over when its last task
 * passes); `not_yet` records the feedback and stays put.
 */
export function applyTaskVerdict(
  plan: TrainingPlan,
  verdict: "pass" | "not_yet",
  summary: string,
  frameFile: string | null,
  now: number,
): VerdictResult {
  const module = currentModule(plan);
  const task = currentTask(plan);
  if (!module || !task) {
    return { plan, enteredNewModule: false, planCompleted: planComplete(plan) };
  }

  const feedback: TaskFeedback = { at: now, verdict, summary, frameFile };
  const { module: mi, task: ti } = plan.cursor;

  if (verdict === "not_yet") {
    const next = mapTask(plan, mi, ti, (t) => ({
      ...t,
      status: t.status === "completed" ? t.status : "in_progress",
      feedback: [...t.feedback, feedback],
    }));
    return {
      plan: { ...next, updatedAt: now },
      enteredNewModule: false,
      planCompleted: false,
    };
  }

  let next = mapTask(plan, mi, ti, (t) => ({
    ...t,
    status: "completed",
    completedAt: now,
    feedback: [...t.feedback, feedback],
  }));

  const moduleDone = ti >= module.tasks.length - 1;
  const lastModule = mi >= plan.modules.length - 1;

  if (moduleDone) {
    next = mapModule(next, mi, (m) => ({ ...m, status: "completed" }));
  }

  let enteredNewModule = false;
  let cursor = plan.cursor;
  if (!moduleDone) {
    cursor = { module: mi, task: ti + 1 };
  } else if (!lastModule) {
    cursor = { module: mi + 1, task: 0 };
    enteredNewModule = true;
  }
  // On the final task of the final module the cursor stays where it is;
  // planComplete() is the signal that there is nothing left.

  next = { ...next, cursor, updatedAt: now };
  next = withStatus(next, "in_progress", now);
  return { plan: next, enteredNewModule, planCompleted: planComplete(next) };
}

function mapTask(
  plan: TrainingPlan,
  mi: number,
  ti: number,
  fn: (t: TrainingTask) => TrainingTask,
): TrainingPlan {
  return mapModule(plan, mi, (m) => ({
    ...m,
    tasks: m.tasks.map((t, i) => (i === ti ? fn(t) : t)),
  }));
}

function mapModule(
  plan: TrainingPlan,
  mi: number,
  fn: (m: TrainingModule) => TrainingModule,
): TrainingPlan {
  return {
    ...plan,
    modules: plan.modules.map((m, i) => (i === mi ? fn(m) : m)),
  };
}

// ── Mistake memory ──

/**
 * Remember a recurring mistake kind. Deduped on word overlap (the coach will
 * phrase the same pattern differently each time it notices it), newest first,
 * capped so the list always fits in the prompt.
 */
export function recordMistakePattern(
  plan: TrainingPlan,
  pattern: string,
  now: number,
): TrainingPlan {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return plan;
  const candidate = keywords(trimmed);
  if (candidate.size === 0) return plan;
  for (const existing of plan.mistakePatterns) {
    const words = keywords(existing);
    if (words.size === 0) continue;
    let hits = 0;
    for (const w of candidate) if (words.has(w)) hits++;
    if (hits / Math.min(candidate.size, words.size) >= 0.7) return plan;
  }
  return {
    ...plan,
    mistakePatterns: [trimmed, ...plan.mistakePatterns].slice(
      0,
      MAX_MISTAKE_PATTERNS,
    ),
    updatedAt: now,
  };
}

// ── Session-end bookkeeping (mechanical — no API calls) ──

function dateStamp(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function appendJournal(
  plan: TrainingPlan,
  sessionId: string,
  note: string,
  now: number,
): TrainingPlan {
  const trimmed = note.trim();
  if (trimmed.length === 0) return plan;
  return {
    ...plan,
    journal: [...plan.journal, { at: now, sessionId, note: trimmed }].slice(
      -MAX_JOURNAL_ENTRIES,
    ),
    updatedAt: now,
  };
}

/**
 * The ~3-line orientation blurb a fresh session reads first. Overwritten, not
 * appended — the PROGRESS.md idea from the curriculum repo this design steals
 * from.
 */
export function buildWhereWeLeftOff(
  plan: TrainingPlan,
  observedSteps: readonly string[],
  now: number,
): string {
  const module = currentModule(plan);
  const task = currentTask(plan);
  if (!module || !task) return plan.whereWeLeftOff;
  if (planComplete(plan)) {
    return `Plan completed ${dateStamp(now)} — every module is done.`;
  }
  const lines = [
    `Last session ${dateStamp(now)}: module ${plan.cursor.module + 1} "${module.title}", task "${task.title}" (${task.status.replace("_", " ")}).`,
  ];
  const recent = observedSteps.filter((s) => s.trim().length > 0).slice(-3);
  if (recent.length > 0) lines.push(`Recently did: ${recent.join("; ")}.`);
  const lastFeedback = task.feedback[task.feedback.length - 1];
  if (lastFeedback) {
    lines.push(
      `Last check: ${lastFeedback.verdict === "pass" ? "passed" : "not yet"} — ${lastFeedback.summary}`,
    );
  }
  return lines.join("\n");
}

// ── Prompt blocks ──

/**
 * Compact orientation: module titles and statuses only. The full curriculum
 * never rides the prompt — the coach sees the map, not the atlas.
 */
export function outlineForPrompt(plan: TrainingPlan): string {
  const { done, total } = taskCounts(plan);
  const lines = plan.modules.map((m, i) => {
    const doneTasks = m.tasks.filter((t) => t.status === "completed").length;
    const state =
      m.status === "completed"
        ? "completed"
        : m.status === "in_progress"
          ? `in progress (${doneTasks}/${m.tasks.length} tasks done)`
          : "upcoming";
    return `${i + 1}. ${m.title} — ${state}`;
  });
  return [`Curriculum (${done}/${total} tasks done):`, ...lines].join("\n");
}

/**
 * The per-session context block: everything the coach needs about this plan,
 * byte-stable until the plan itself changes (cursor moves, mistakes recorded).
 */
export function trainingContextBlock(plan: TrainingPlan): string {
  const module = currentModule(plan);
  const task = currentTask(plan);
  const parts = [`Training plan: "${plan.title}".`];
  if (plan.learnerProfile) parts.push(`Learner: ${plan.learnerProfile}`);
  parts.push(outlineForPrompt(plan));
  if (module && task) {
    parts.push(
      `Current task (module ${plan.cursor.module + 1} "${module.title}"): "${task.title}"`,
    );
    if (task.objective) parts.push(`Objective: ${task.objective}`);
    if (task.doneCriteria.length > 0) {
      parts.push(
        `Done when:\n${task.doneCriteria.map((c) => `- ${c}`).join("\n")}`,
      );
    }
  }
  if (plan.mistakePatterns.length > 0) {
    parts.push(
      `Recurring mistakes to watch for:\n${plan.mistakePatterns.map((m) => `- ${m}`).join("\n")}`,
    );
  }
  if (plan.whereWeLeftOff) {
    parts.push(`Where we left off:\n${plan.whereWeLeftOff}`);
  }
  return parts.join("\n\n");
}
