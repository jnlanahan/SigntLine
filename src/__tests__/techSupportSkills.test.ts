import { describe, it, expect } from "vitest";
import { techSupportSystemPrompt } from "../../electron/agents/tech-support";

// The tech support agent's skill set, locked by regression guards: each
// skill has a load-bearing phrase in the system prompt and (where relevant)
// a field in the output schema. Removing one must be deliberate.

const prompt = techSupportSystemPrompt();

describe("tech support agent skills", () => {
  it("troubleshoot: has an explicit troubleshooting protocol", () => {
    expect(prompt).toContain("Troubleshooting — when something goes wrong");
    expect(prompt).toContain('"troubleshooting": true');
    // One hypothesis at a time, smallest fix first.
    expect(prompt).toContain("ONE fix attempt at a time");
    // Escalates to research instead of guessing forever.
    expect(prompt).toContain("After two failed attempts");
    expect(prompt).toContain("EXACT error text");
  });

  it("verify: states an expected result and checks it before advancing", () => {
    expect(prompt).toContain("Verify before advancing");
    expect(prompt).toContain('"expected_result"');
    expect(prompt).toContain("never advance past a step that didn't actually happen");
  });

  it("replan: owns upcoming_steps and rewrites them when blocked", () => {
    expect(prompt).toContain("Replanning");
    expect(prompt).toContain("YOUR plan and you own it");
  });

  it("point: highlight field for the glow flash", () => {
    expect(prompt).toContain('"highlight"');
    expect(prompt).toContain("bounding box as fractions");
  });

  it("schema: action key still comes first (speech gating depends on it)", () => {
    expect(prompt).toContain('Output the "action" key FIRST');
    // And the schema line itself starts with action.
    expect(prompt).toMatch(/Schema: \{"action":/);
  });

  it("schema: includes the troubleshooting and expected_result fields", () => {
    expect(prompt).toContain('"expected_result": string');
    expect(prompt).toContain('"troubleshooting": boolean');
  });
});
