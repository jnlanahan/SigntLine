import { describe, expect, it } from "vitest";
import { techSupportSystemPrompt } from "../../electron/agents/tech-support";
import { trainingSystemPrompt } from "../../electron/agents/training";
import { teacherSystemPrompt } from "../../electron/agents/teacher";
import { parseInstruction } from "../../electron/instruction-parse";

const PROMPTS: Array<[string, string]> = [
  ["tech support", techSupportSystemPrompt()],
  ["training", trainingSystemPrompt()],
  ["teacher", teacherSystemPrompt()],
];

describe("every agent can choose to stay silent", () => {
  // The bug this locks: a mode with no "action" field had no way to express
  // "say nothing". Its silent turns parsed as "instruct" with an empty
  // instruction, which fell back to speaking the raw JSON response aloud.
  it.each(PROMPTS)("%s declares the action set", (_name, prompt) => {
    expect(prompt).toContain('"action"');
    expect(prompt).toContain('"wait"');
  });

  it.each(PROMPTS)("%s emits the action first, so speech can be gated", (_name, prompt) => {
    expect(prompt).toContain('Output the "action" key FIRST');
  });

  it.each(PROMPTS)("%s requires an empty instruction on a silent turn", (_name, prompt) => {
    expect(prompt.toLowerCase()).toContain("empty string when action is \"wait\"");
  });
});

describe("every agent shares the same output contract", () => {
  it.each(PROMPTS)("%s asks for bare JSON", (_name, prompt) => {
    expect(prompt).toContain("JSON object only");
    expect(prompt).toContain("no code fences");
  });

  it.each(PROMPTS)("%s declares the cross-session memory field", (_name, prompt) => {
    expect(prompt).toContain('"remember"');
    expect(prompt).toContain('"setup"|"preference"|"history"|"obstacle"');
  });

  it.each(PROMPTS)("%s keeps the shared voice rules", (_name, prompt) => {
    expect(prompt).toContain("Sound like a human, not a script");
  });

  it.each(PROMPTS)("%s never promises to wait for the user to report in", (_name, prompt) => {
    // The app is watching the screen; asking for a thumbs-up is both wrong and
    // the fastest way to make it feel like it isn't paying attention.
    expect(prompt).toContain('NEVER say "let me know when you\'re done"');
  });
});

describe("agent roles stay distinct", () => {
  it("tech support directs, training does not", () => {
    expect(trainingSystemPrompt()).toContain("Never tell the user how to do something");
    expect(techSupportSystemPrompt()).toContain("one concrete step at a time");
  });

  it("training treats silence as the default", () => {
    expect(trainingSystemPrompt()).toContain("overwhelming majority of your turns");
  });

  it("teacher is conversational rather than screen-driven", () => {
    expect(teacherSystemPrompt()).toContain("This is a CONVERSATION");
  });

  it("only tech support points at things on screen", () => {
    expect(techSupportSystemPrompt()).toContain('"highlight"');
    // The other two explicitly pin highlight to null rather than leaving it
    // open — neither should ever draw a box on the user's screen.
    expect(trainingSystemPrompt()).toContain('"highlight" is always null');
    expect(teacherSystemPrompt()).toContain('"highlight" is always null');
  });

  it("only tech support troubleshoots", () => {
    expect(techSupportSystemPrompt()).toContain("Troubleshooting");
    expect(trainingSystemPrompt()).toContain('"troubleshooting": false');
    expect(teacherSystemPrompt()).toContain('"troubleshooting": false');
  });
});

describe("memory rules protect the user", () => {
  it.each(PROMPTS)("%s refuses to remember sensitive details", (_name, prompt) => {
    const lower = prompt.toLowerCase();
    // Every agent gets this via its own memory rules or the shared field
    // rules; a coach that memorizes a password is a security incident.
    expect(
      lower.includes("sensitive") || lower.includes("password"),
    ).toBe(true);
  });
});

describe("a silent turn stays silent end to end", () => {
  it("parses a wait turn without inventing speech", () => {
    const response = JSON.stringify({
      action: "wait",
      expected_pace: "medium",
      instruction: "",
      completed_steps: ["Opened the admin panel"],
      upcoming_steps: [],
      digression: false,
      needsResearch: false,
      researchQuery: "",
      notes: "",
      highlight: null,
      remember: null,
    });
    const parsed = parseInstruction(response, []);
    expect(parsed.action).toBe("wait");
    expect(parsed.instruction).toBe("");
  });

  it("never falls back to reading the raw JSON aloud on a wait", () => {
    // The old failure mode: instruction was empty, so the parser substituted
    // the entire response text, and TTS read the JSON to the user.
    const response = '{"action":"wait","instruction":"","completed_steps":[]}';
    const parsed = parseInstruction(response, []);
    expect(parsed.instruction).not.toContain("{");
    expect(parsed.instruction).not.toContain("action");
  });
});
