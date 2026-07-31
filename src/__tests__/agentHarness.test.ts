import { describe, expect, it } from "vitest";
import { allAgents, describeAgent, getAgent } from "../../electron/agents/registry";
import {
  midTurnTools,
  systemPrompt,
  terminalTools,
  toolDefinitions,
} from "../../electron/agents/harness/schema";
import { buildContextHeader } from "../../electron/agents/harness/context";
import { applyPlanEdits } from "../../electron/agents/tools/plan";
import type {
  Agent,
  TurnContext,
} from "../../electron/agents/harness/types";
import type { AppMode } from "../../electron/types";

const AGENTS: Array<[string, Agent]> = allAgents().map((a) => [a.id, a]);

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    mode: "tech_support",
    goal: "Set up a VPN",
    completedSteps: [],
    upcomingSteps: [],
    conversation: [],
    frames: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Prompt caching. Tools render before system, which renders before messages,
// so a byte change in either prefix re-writes the cache for the whole session
// and every later tick silently pays full price.
// ---------------------------------------------------------------------------

describe("the cached prefix is byte-stable", () => {
  it.each(AGENTS)("%s builds an identical system prompt every time", (_n, agent) => {
    expect(systemPrompt(agent)).toBe(systemPrompt(agent));
  });

  it.each(AGENTS)("%s builds an identical tool list every time", (_n, agent) => {
    expect(JSON.stringify(toolDefinitions(agent))).toBe(
      JSON.stringify(toolDefinitions(agent)),
    );
  });

  it.each(AGENTS)("%s keeps per-tick data out of the system prompt", (_n, agent) => {
    // Anything that varies tick to tick belongs in the context header, after
    // the cache breakpoint. A timestamp or a step count leaking in here is the
    // classic way a cache hit rate collapses to zero.
    const prompt = systemPrompt(agent);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/); // a date
    expect(prompt).not.toMatch(/\bscreen last changed\b/);
    expect(prompt).not.toContain("Original goal:");
  });

  it.each(AGENTS)("%s puts the terminal tools first", (_n, agent) => {
    // They are the two most-used definitions in the session; keeping them at
    // the very front of the prefix means a skill added later never shifts them.
    const names = toolDefinitions(agent).map((t) => t.name);
    expect(names.slice(0, 2)).toEqual(["say", "wait"]);
  });

  it.each(AGENTS)("%s declares no duplicate tools", (_n, agent) => {
    const names = toolDefinitions(agent).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// Schema assembly from skills
// ---------------------------------------------------------------------------

describe("skills assemble into the terminal tools", () => {
  it("a skill's output fields land on the tools it declared", () => {
    const agent = getAgent("tech_support");
    const say = terminalTools(agent).find((t) => t.name === "say")!;
    const wait = terminalTools(agent).find((t) => t.name === "wait")!;
    // verify declares expected_result "on: say" — speech-only.
    expect(say.input_schema.properties).toHaveProperty("expected_result");
    expect(wait.input_schema.properties).not.toHaveProperty("expected_result");
    // notes declares "on: both" — a silent turn can still record one.
    expect(say.input_schema.properties).toHaveProperty("notes");
    expect(wait.input_schema.properties).toHaveProperty("notes");
  });

  it("a skill's tools only appear on agents that compose it", () => {
    // screenReading is shared by tech support and teacher; training has no use
    // for a zoom lens because it is not reading anything back to anyone.
    expect(midTurnTools(getAgent("tech_support")).map((t) => t.name)).toContain(
      "read_screen_region",
    );
    expect(midTurnTools(getAgent("teacher")).map((t) => t.name)).toContain(
      "read_screen_region",
    );
    expect(midTurnTools(getAgent("training")).map((t) => t.name)).not.toContain(
      "read_screen_region",
    );
  });

  it("the plan editing tools belong to training alone", () => {
    // They cost a round trip each. Only the agent whose plan IS the
    // deliverable — and which polls once a minute — can afford them.
    expect(midTurnTools(getAgent("training")).map((t) => t.name)).toEqual([
      "plan_add_step",
      "plan_revise_step",
      "plan_complete_step",
    ]);
  });

  it("every mid-turn tool declares an object schema with required fields", () => {
    for (const agent of allAgents()) {
      for (const tool of midTurnTools(agent)) {
        expect(tool.inputSchema.type).toBe("object");
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Context blocks
// ---------------------------------------------------------------------------

describe("skills contribute per-turn context", () => {
  it("verify round-trips the previous expected result", () => {
    const header = buildContextHeader(
      getAgent("tech_support"),
      ctx({ lastExpectedResult: "the query editor opens" }),
      1,
    );
    expect(header).toContain("the query editor opens");
  });

  it("an agent without the verify skill never emits that block", () => {
    const header = buildContextHeader(
      getAgent("teacher"),
      ctx({ mode: "teacher", lastExpectedResult: "the query editor opens" }),
      1,
    );
    expect(header).not.toContain("the query editor opens");
  });

  it("the training context block reaches only the training agent", () => {
    const block = 'Training plan: "Pivot Tables from Zero".';
    const trained = buildContextHeader(
      getAgent("training"),
      ctx({ mode: "training", trainingContext: block }),
      1,
    );
    expect(trained).toContain(block);
    const support = buildContextHeader(
      getAgent("tech_support"),
      ctx({ trainingContext: block }),
      1,
    );
    expect(support).not.toContain(block);
  });

  it("situational guidance comes last, after the skill blocks", () => {
    const agent = getAgent("tech_support");
    const header = buildContextHeader(agent, ctx({ stalled: true }), 1);
    expect(header.indexOf(agent.guidance.stalled)).toBeGreaterThan(
      header.indexOf("Original goal:"),
    );
    expect(header.endsWith(agent.nextTurnPrompt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loop policy. These are the timings the old getModeConfig switch held; they
// now live on the agents. Changing one means changing it here deliberately.
// ---------------------------------------------------------------------------

describe("each agent declares its own loop", () => {
  it("tech support polls aggressively and reacts to input", () => {
    const { loop } = getAgent("tech_support");
    expect(loop.minCallSpacingMs).toBe(3_000);
    expect(loop.normalIntervalMs).toBe(15_000);
    expect(loop.slowIntervalMs).toBe(30_000);
    expect(loop.quietPeriodMs).toBe(1_500);
    expect(loop.stallEnabled).toBe(true);
    expect(loop.requireScreenChange).toBe(true);
  });

  it("training polls slowly and ignores input entirely", () => {
    const { loop } = getAgent("training");
    expect(loop.minCallSpacingMs).toBe(10_000);
    expect(loop.normalIntervalMs).toBe(60_000);
    expect(loop.quietPeriodMs).toBe(0);
    expect(loop.stallEnabled).toBe(false);
  });

  it("teacher does not poll at all", () => {
    // normalIntervalMs=0 exits the backstop chain; requireScreenChange=false
    // means a pending follow-up is the ONLY thing that wakes it.
    const { loop } = getAgent("teacher");
    expect(loop.normalIntervalMs).toBe(0);
    expect(loop.slowIntervalMs).toBe(0);
    expect(loop.quietPeriodMs).toBe(0);
    expect(loop.requireScreenChange).toBe(false);
  });

  it.each(AGENTS)("%s allows at least one turn", (_n, agent) => {
    // maxToolIterations < 1 would mean the runner never calls the model.
    expect(agent.maxToolIterations).toBeGreaterThanOrEqual(1);
  });

  it("an agent with mid-turn tools leaves room to use one and still speak", () => {
    for (const agent of allAgents()) {
      if (midTurnTools(agent).length === 0) continue;
      expect(agent.maxToolIterations).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("describeAgent carries only what crosses the bridge", () => {
  it.each(AGENTS)("%s describes as plain data", (_n, agent) => {
    const descriptor = describeAgent(agent.id as AppMode);
    expect(descriptor.loop).toEqual(agent.loop);
    expect(descriptor.skills).toEqual(agent.skills.map((s) => s.id));
    // Must survive structured clone across IPC — no functions, no classes.
    expect(() => structuredClone(descriptor)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Plan edits
// ---------------------------------------------------------------------------

describe("plan edits merge onto the reported plan", () => {
  it("adds a step without duplicating one already reported", () => {
    const out = applyPlanEdits(["Open the admin panel"], [], [
      { op: "add", description: "Open the admin panel" },
      { op: "add", description: "Select the user's role" },
    ]);
    expect(out.completed).toEqual(["Open the admin panel", "Select the user's role"]);
  });

  it("revises in place rather than appending a second version", () => {
    // The whole reason for a revise op: a corrected step must read as one
    // step, not as the fumble followed by the fix.
    const out = applyPlanEdits(["Click Setings"], [], [
      { op: "revise", index: 0, description: "Click Settings" },
    ]);
    expect(out.completed).toEqual(["Click Settings"]);
  });

  it("moves a completed step out of upcoming", () => {
    const out = applyPlanEdits([], ["Save and confirm", "Close the panel"], [
      { op: "complete", index: 0 },
    ]);
    expect(out.completed).toEqual(["Save and confirm"]);
    expect(out.upcoming).toEqual(["Close the panel"]);
  });

  it("ignores an out-of-range index instead of throwing", () => {
    // A bad index must not fail the turn — the user is waiting on speech.
    const out = applyPlanEdits(["a"], ["b"], [
      { op: "revise", index: 9, description: "x" },
      { op: "complete", index: 9 },
    ]);
    expect(out.completed).toEqual(["a"]);
    expect(out.upcoming).toEqual(["b"]);
  });
});
