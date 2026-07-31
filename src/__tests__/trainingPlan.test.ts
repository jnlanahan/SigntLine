import { describe, expect, it } from "vitest";
import {
  MAX_MISTAKE_PATTERNS,
  applyModuleDetail,
  applyTaskVerdict,
  appendJournal,
  beginRun,
  buildPlanFromOutline,
  buildWhereWeLeftOff,
  currentModule,
  currentTask,
  outlineForPrompt,
  planComplete,
  planProgress,
  recordMistakePattern,
  taskCounts,
  trainingContextBlock,
} from "../../electron/training-plan";
import type { CurriculumOutline } from "../../electron/training-plan";
import type { TrainingPlan } from "../../electron/db/schema";

const NOW = 1_800_000_000_000;

let seq = 0;
const idFor = (prefix: string) => `${prefix}_${String(++seq).padStart(3, "0")}`;

const OUTLINE: CurriculumOutline = {
  title: "Pivot Tables from Zero",
  overview: "Learn pivot tables by summarizing a real sales sheet.",
  learnerProfile: "Comfortable in Excel basics; learns by doing; ~1h sessions.",
  modules: [
    {
      title: "Reading the data",
      summary: "Understand the sheet before summarizing it.",
      taskTitles: ["Open and explore the sheet", "Sort and filter"],
    },
    {
      title: "First pivot table",
      summary: "Build and read a basic pivot.",
      taskTitles: ["Insert a pivot table", "Group by month"],
    },
  ],
};

function freshPlan(): TrainingPlan {
  return buildPlanFromOutline(OUTLINE, "learn pivot tables", {
    id: "plan_test",
    now: NOW,
    idFor,
  });
}

function detailedPlan(): TrainingPlan {
  let plan = freshPlan();
  plan = applyModuleDetail(
    plan,
    0,
    [
      {
        title: "Open and explore the sheet",
        objective: "You can describe what each column holds",
        doneCriteria: ["Sheet is open", "Named the key columns aloud"],
      },
      {
        title: "Sort and filter",
        objective: "You can isolate one region's rows",
        doneCriteria: ["Filter applied", "Row count matches the region"],
      },
    ],
    { now: NOW, idFor },
  );
  return plan;
}

describe("buildPlanFromOutline", () => {
  it("creates outlined, undetailed modules with a zeroed cursor", () => {
    const plan = freshPlan();
    expect(plan.modules).toHaveLength(2);
    expect(plan.modules[0].detailed).toBe(false);
    expect(plan.modules[0].tasks[0].objective).toBeNull();
    expect(plan.cursor).toEqual({ module: 0, task: 0 });
    expect(plan.runCount).toBe(0);
    expect(plan.mistakePatterns).toEqual([]);
  });

  it("drops empty modules and blank task titles", () => {
    const plan = buildPlanFromOutline(
      {
        ...OUTLINE,
        modules: [
          { title: "  ", summary: "", taskTitles: ["x"] },
          { title: "Real", summary: "s", taskTitles: ["a", "  ", "b"] },
        ],
      },
      "goal",
      { id: "p", now: NOW, idFor },
    );
    expect(plan.modules).toHaveLength(1);
    expect(plan.modules[0].tasks.map((t) => t.title)).toEqual(["a", "b"]);
  });

  it("falls back to the goal when the title is blank", () => {
    const plan = buildPlanFromOutline(
      { ...OUTLINE, title: " " },
      "learn pivot tables",
      { id: "p", now: NOW, idFor },
    );
    expect(plan.title).toBe("learn pivot tables");
  });
});

describe("applyModuleDetail", () => {
  it("fills objectives and criteria and marks the module detailed", () => {
    const plan = detailedPlan();
    expect(plan.modules[0].detailed).toBe(true);
    expect(plan.modules[0].tasks[0].objective).toContain("each column");
    expect(plan.modules[0].tasks[1].doneCriteria).toHaveLength(2);
    // Module 1 untouched.
    expect(plan.modules[1].detailed).toBe(false);
  });

  it("ignores empty detail rather than emptying the module", () => {
    const plan = freshPlan();
    expect(applyModuleDetail(plan, 0, [], { now: NOW, idFor })).toBe(plan);
  });

  it("refuses to overwrite a module with completed work", () => {
    let plan = detailedPlan();
    plan = applyTaskVerdict(plan, "pass", "done", null, NOW).plan;
    const again = applyModuleDetail(
      plan,
      0,
      [{ title: "t", objective: "o", doneCriteria: [] }],
      { now: NOW, idFor },
    );
    expect(again).toBe(plan);
  });

  it("clamps the cursor when detailing shrinks the current module", () => {
    let plan = freshPlan();
    plan = { ...plan, cursor: { module: 0, task: 1 } };
    plan = applyModuleDetail(
      plan,
      0,
      [{ title: "only", objective: "o", doneCriteria: ["c"] }],
      { now: NOW, idFor },
    );
    expect(plan.cursor).toEqual({ module: 0, task: 0 });
  });
});

describe("applyTaskVerdict", () => {
  it("not_yet records feedback and stays put", () => {
    const plan = detailedPlan();
    const res = applyTaskVerdict(plan, "not_yet", "missing filter", "f1.jpg", NOW);
    expect(res.plan.cursor).toEqual({ module: 0, task: 0 });
    const task = currentTask(res.plan)!;
    expect(task.status).toBe("in_progress");
    expect(task.feedback).toEqual([
      { at: NOW, verdict: "not_yet", summary: "missing filter", frameFile: "f1.jpg" },
    ]);
    expect(res.enteredNewModule).toBe(false);
    expect(res.planCompleted).toBe(false);
  });

  it("pass completes the task and advances within the module", () => {
    const res = applyTaskVerdict(detailedPlan(), "pass", "nice", null, NOW);
    expect(res.plan.modules[0].tasks[0].status).toBe("completed");
    expect(res.plan.modules[0].tasks[0].completedAt).toBe(NOW);
    expect(res.plan.cursor).toEqual({ module: 0, task: 1 });
    expect(currentTask(res.plan)!.status).toBe("in_progress");
    expect(res.enteredNewModule).toBe(false);
  });

  it("passing the last task rolls into the next module", () => {
    let plan = detailedPlan();
    plan = applyTaskVerdict(plan, "pass", "one", null, NOW).plan;
    const res = applyTaskVerdict(plan, "pass", "two", null, NOW);
    expect(res.plan.modules[0].status).toBe("completed");
    expect(res.plan.cursor).toEqual({ module: 1, task: 0 });
    expect(res.enteredNewModule).toBe(true);
    expect(res.planCompleted).toBe(false);
  });

  it("passing the final task completes the plan and keeps the cursor in bounds", () => {
    let plan = detailedPlan();
    for (const summary of ["a", "b", "c"]) {
      plan = applyTaskVerdict(plan, "pass", summary, null, NOW).plan;
    }
    const res = applyTaskVerdict(plan, "pass", "d", null, NOW);
    expect(res.planCompleted).toBe(true);
    expect(planComplete(res.plan)).toBe(true);
    expect(res.enteredNewModule).toBe(false);
    expect(currentTask(res.plan)).not.toBeNull();
    expect(planProgress(res.plan)).toBe(1);
  });

  it("is safe on an out-of-range cursor", () => {
    const broken = { ...detailedPlan(), cursor: { module: 9, task: 9 } };
    const res = applyTaskVerdict(broken, "pass", "x", null, NOW);
    expect(res.plan).toBe(broken);
  });
});

describe("beginRun", () => {
  it("counts the run and marks the cursor in progress", () => {
    const plan = beginRun(detailedPlan(), NOW);
    expect(plan.runCount).toBe(1);
    expect(currentModule(plan)!.status).toBe("in_progress");
    expect(currentTask(plan)!.status).toBe("in_progress");
  });
});

describe("recordMistakePattern", () => {
  it("adds newest first and skips near-duplicates", () => {
    let plan = detailedPlan();
    plan = recordMistakePattern(plan, "Forgets to apply the region filter", NOW);
    plan = recordMistakePattern(plan, "Uses raw numbers instead of percentages", NOW);
    expect(plan.mistakePatterns[0]).toContain("percentages");
    const before = plan.mistakePatterns;
    plan = recordMistakePattern(plan, "forgets applying the region filter", NOW);
    expect(plan.mistakePatterns).toEqual(before);
  });

  it("caps the list", () => {
    let plan = detailedPlan();
    for (let i = 0; i < MAX_MISTAKE_PATTERNS + 3; i++) {
      plan = recordMistakePattern(
        plan,
        `distinct mistake alpha${i} bravo${i} charlie${i}`,
        NOW,
      );
    }
    expect(plan.mistakePatterns).toHaveLength(MAX_MISTAKE_PATTERNS);
  });

  it("ignores blank patterns", () => {
    const plan = detailedPlan();
    expect(recordMistakePattern(plan, "   ", NOW)).toBe(plan);
  });
});

describe("session-end bookkeeping", () => {
  it("appendJournal appends trimmed notes", () => {
    const plan = appendJournal(detailedPlan(), "sess_1", "  worked task 1  ", NOW);
    expect(plan.journal).toEqual([
      { at: NOW, sessionId: "sess_1", note: "worked task 1" },
    ]);
  });

  it("buildWhereWeLeftOff names the position, recent steps, and last check", () => {
    let plan = detailedPlan();
    plan = applyTaskVerdict(plan, "not_yet", "filter missing", null, NOW).plan;
    const blurb = buildWhereWeLeftOff(
      plan,
      ["opened sheet", "sorted by date", "added filter"],
      NOW,
    );
    expect(blurb).toContain('module 1 "Reading the data"');
    expect(blurb).toContain("sorted by date");
    expect(blurb).toContain("not yet — filter missing");
    expect(blurb.split("\n").length).toBeLessThanOrEqual(3);
  });

  it("buildWhereWeLeftOff reports a completed plan", () => {
    let plan = detailedPlan();
    for (const s of ["a", "b", "c", "d"]) {
      plan = applyTaskVerdict(plan, "pass", s, null, NOW).plan;
    }
    expect(buildWhereWeLeftOff(plan, [], NOW)).toContain("Plan completed");
  });
});

describe("prompt blocks", () => {
  it("outlineForPrompt lists modules with statuses, not tasks", () => {
    let plan = detailedPlan();
    plan = applyTaskVerdict(plan, "pass", "ok", null, NOW).plan;
    const outline = outlineForPrompt(plan);
    expect(outline).toContain("1. Reading the data — in progress (1/2 tasks done)");
    expect(outline).toContain("2. First pivot table — upcoming");
    expect(outline).not.toContain("Insert a pivot table");
  });

  it("trainingContextBlock carries profile, current task detail, and memory", () => {
    let plan = detailedPlan();
    plan = recordMistakePattern(plan, "Skips saving before closing", NOW);
    plan = { ...plan, whereWeLeftOff: "Last session: task 1 in progress." };
    const block = trainingContextBlock(plan);
    expect(block).toContain("Learner: Comfortable in Excel basics");
    expect(block).toContain('Current task (module 1 "Reading the data")');
    expect(block).toContain("Objective: You can describe what each column holds");
    expect(block).toContain("- Sheet is open");
    expect(block).toContain("Skips saving before closing");
    expect(block).toContain("Where we left off:");
  });

  it("is byte-stable for an unchanged plan", () => {
    const plan = detailedPlan();
    expect(trainingContextBlock(plan)).toBe(trainingContextBlock(plan));
  });
});

describe("taskCounts", () => {
  it("counts across modules", () => {
    let plan = detailedPlan();
    plan = applyTaskVerdict(plan, "pass", "ok", null, NOW).plan;
    expect(taskCounts(plan)).toEqual({ done: 1, total: 4 });
  });
});
