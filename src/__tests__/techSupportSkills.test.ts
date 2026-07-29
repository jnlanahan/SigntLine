import { describe, it, expect } from "vitest";
import { techSupportAgent } from "../../electron/agents/tech-support";
import {
  midTurnTools,
  systemPrompt,
  terminalTools,
} from "../../electron/agents/harness/schema";

// The tech support agent's skill set, locked by regression guards. Each skill
// is now a module (electron/agents/skills/), so composition is checked
// directly — a skill dropped from the agent's list fails here rather than
// silently changing how the coach behaves.

const prompt = systemPrompt(techSupportAgent);
const skillIds = techSupportAgent.skills.map((s) => s.id);
const sayProps = terminalTools(techSupportAgent).find((t) => t.name === "say")!
  .input_schema.properties;
const toolNames = midTurnTools(techSupportAgent).map((t) => t.name);

describe("tech support agent skills", () => {
  it("composes the expected skill set", () => {
    expect(skillIds).toEqual([
      "speech",
      "pacing",
      "verify",
      "troubleshoot",
      "research",
      "screenReading",
      "plan",
      "pointing",
      "notes",
      "memory",
    ]);
  });

  it("pacing: wait is framed as the default, not a failure", () => {
    expect(prompt).toContain("most common turn by a wide margin");
    expect(prompt).toContain("good coaching, not laziness");
  });

  it("troubleshoot: has an explicit troubleshooting protocol", () => {
    expect(prompt).toContain("Troubleshooting — when something goes wrong");
    expect(sayProps).toHaveProperty("troubleshooting");
    // One hypothesis at a time, smallest fix first.
    expect(prompt).toContain("ONE fix attempt at a time");
    // Escalates to a real search instead of guessing forever.
    expect(prompt).toContain("After two failed attempts");
    expect(prompt).toContain("EXACT error text");
  });

  it("verify: states an expected result and checks it before advancing", () => {
    expect(prompt).toContain("Verify before advancing");
    expect(sayProps).toHaveProperty("expected_result");
    expect(prompt).toContain(
      "never advance past a step that didn't actually happen",
    );
  });

  it("replan: owns upcoming_steps and rewrites them when blocked", () => {
    expect(prompt).toContain("Replanning");
    expect(prompt).toContain("YOUR plan and you own it");
  });

  it("point: highlight field for the glow flash", () => {
    expect(sayProps).toHaveProperty("highlight");
    expect(prompt).toContain("bounding box as fractions");
  });

  it("research: searches mid-turn rather than costing a whole extra tick", () => {
    expect(toolNames).toContain("search_web");
    expect(prompt).toContain("in this same turn");
  });

  it("screenReading: can zoom in when text is too small to trust", () => {
    expect(toolNames).toContain("read_screen_region");
    // Both the skills that depend on being able to read small text say so, so
    // the agent reaches for the lens at the moments that matter.
    expect(prompt).toContain("zoom in with read_screen_region");
  });

  it("memory: records durable facts, not this session's state", () => {
    expect(sayProps).toHaveProperty("remember");
    expect(prompt).toContain("Do NOT remember anything transient");
  });

  it("does not carry the training-only plan editing tools", () => {
    // Those cost a round trip each. Tech support polls every 15s with a live
    // user waiting on speech; it rewrites upcoming_steps inline instead.
    expect(toolNames).not.toContain("plan_add_step");
  });
});
