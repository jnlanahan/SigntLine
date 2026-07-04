import { describe, it, expect } from "vitest";
import { parseInstruction } from "../../electron/instruction-parse";

describe("parseInstruction", () => {
  it("parses a normal instruct response", () => {
    const r = parseInstruction(
      JSON.stringify({
        action: "instruct",
        expected_pace: "quick",
        instruction: "Click the blue Save button.",
        completed_steps: ["Opened the editor"],
        upcoming_steps: ["Verify the file saved"],
        digression: false,
        needsResearch: false,
        researchQuery: "",
        notes: "",
        highlight: { x: 0.4, y: 0.2, w: 0.1, h: 0.05 },
      }),
      [],
    );
    expect(r.action).toBe("instruct");
    expect(r.expectedPace).toBe("quick");
    expect(r.instruction).toBe("Click the blue Save button.");
    expect(r.highlight).toEqual({ x: 0.4, y: 0.2, w: 0.1, h: 0.05 });
  });

  it("clamps an out-of-range highlight instead of dropping it", () => {
    const r = parseInstruction(
      JSON.stringify({
        action: "instruct",
        instruction: "Click it.",
        highlight: { x: 0.95, y: -0.1, w: 0.2, h: 0.3 },
      }),
      [],
    );
    expect(r.highlight).not.toBeNull();
    expect(r.highlight!.x).toBe(0.95);
    expect(r.highlight!.y).toBe(0);
    expect(r.highlight!.w).toBeCloseTo(0.05, 10);
    expect(r.highlight!.h).toBe(0.3);
  });

  it("rejects malformed highlights", () => {
    for (const bad of [
      { x: "0.5", y: 0.5, w: 0.1, h: 0.1 },
      { x: 0.5, y: 0.5 },
      "0.5,0.5",
      { x: 0.5, y: 0.5, w: 0, h: 0.1 },
      null,
    ]) {
      const r = parseInstruction(
        JSON.stringify({ action: "instruct", instruction: "x", highlight: bad }),
        [],
      );
      expect(r.highlight).toBeNull();
    }
  });

  it("never attaches a highlight to non-instruct actions", () => {
    const r = parseInstruction(
      JSON.stringify({
        action: "wait",
        instruction: "",
        highlight: { x: 0.4, y: 0.2, w: 0.1, h: 0.05 },
      }),
      [],
    );
    expect(r.action).toBe("wait");
    expect(r.highlight).toBeNull();
  });

  it("keeps previous steps and defaults on unparseable output", () => {
    const r = parseInstruction("Just click the button.", ["step one"]);
    expect(r.action).toBe("instruct");
    expect(r.instruction).toBe("Just click the button.");
    expect(r.completedSteps).toEqual(["step one"]);
    expect(r.highlight).toBeNull();
  });

  it("legacy modes without an action default to instruct/done", () => {
    const done = parseInstruction(
      JSON.stringify({ instruction: "All set!", done: true }),
      [],
    );
    expect(done.action).toBe("done");
    expect(done.done).toBe(true);
  });
});
