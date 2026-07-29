import { describe, it, expect } from "vitest";

import { techSupportAgent } from "../../electron/agents/tech-support";
import { speechSkill } from "../../electron/agents/skills/speech";
import { systemPrompt } from "../../electron/agents/harness/schema";

// Load-bearing prompt phrases, locked so removing one is a deliberate
// decision rather than a side effect. The voice rules are now the `speech`
// skill (shared by all three agents); the never-dead-air rules are the tech
// support agent's situational guidance.

const voiceRules = speechSkill.systemFragment ?? "";
const techSupportPrompt = systemPrompt(techSupportAgent);

describe("shared voice rules", () => {
  it("contains 'One action per response'", () => {
    expect(voiceRules).toContain("One action per response");
  });

  it("contains 'end on a natural landing point'", () => {
    expect(voiceRules).toContain("natural landing point");
  });

  it("keeps responses short (60-word cap)", () => {
    expect(voiceRules).toContain("never more than 60 words");
  });

  it("asks for one idea per sentence (chunked-TTS friendly)", () => {
    expect(voiceRules).toContain("One idea per sentence");
  });

  it("reaches every agent, not just tech support", () => {
    // The voice is the product. A mode that silently lost these rules would
    // still work and would sound like a different app.
    expect(techSupportPrompt).toContain("One idea per sentence");
  });
});

describe("tech support agent — pacing", () => {
  it("contains pacing instruction", () => {
    expect(techSupportPrompt).toContain("one concrete step at a time");
  });
});

describe("tech support agent — never-dead-air rules", () => {
  it("first turn forces a spoken first step", () => {
    const { sessionStart } = techSupportAgent.guidance;
    expect(sessionStart).toContain("The session just started");
    expect(sessionStart).toContain("Do not call wait");
    expect(sessionStart).toContain("do not set digression=true");
  });

  it("stall check-in mentions the wrong-monitor possibility", () => {
    expect(techSupportAgent.guidance.stalled).toContain("which screen or monitor");
  });

  it("stall guidance checks for completed steps before waiting", () => {
    expect(techSupportAgent.guidance.stalled).toContain(
      "if the user already completed that step, give the NEXT step now",
    );
  });
});
