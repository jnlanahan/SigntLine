import { describe, expect, it } from "vitest";
import {
  instructionsAreSimilar,
  isRepeatedSentence,
  MIN_REPEAT_CHARS,
} from "../lib/repeatGuard";

// These cases are taken from a real session log (7/29) where the coach spoke
// the same instruction twice within 7 seconds.
const TWO_SENTENCE_TURN =
  "Claude's asking what the task should do. Go ahead and click 'Something else', that'll let you describe your custom task.";
const REPEATED_TAIL = "Go ahead and click 'Something else', that's the one we want for a custom task.";

describe("instructionsAreSimilar", () => {
  it("matches the same instruction through punctuation and case differences", () => {
    expect(
      instructionsAreSimilar(
        "Go ahead and click the 'Professional — LinkedIn' tab.",
        "go ahead and click the professional linkedin tab",
      ),
    ).toBe(true);
  });

  it("does not match two different instructions", () => {
    expect(
      instructionsAreSimilar("Click the Me menu.", "Click View profile."),
    ).toBe(false);
  });

  it("never matches on empty text — an empty last instruction is not a repeat", () => {
    expect(instructionsAreSimilar("Click Save.", "")).toBe(false);
    expect(instructionsAreSimilar("", "")).toBe(false);
  });
});

describe("isRepeatedSentence", () => {
  it("catches a sentence re-emitted from a longer previous turn", () => {
    // The whole-instruction comparison misses this: the new turn is not equal
    // to the old one, it just says the same thing again in its first sentence.
    expect(instructionsAreSimilar(REPEATED_TAIL, TWO_SENTENCE_TURN)).toBe(false);
    expect(
      isRepeatedSentence(
        "Go ahead and click 'Something else', that'll let you describe your custom task.",
        TWO_SENTENCE_TURN,
      ),
    ).toBe(true);
  });

  it("lets a genuinely new sentence through", () => {
    expect(
      isRepeatedSentence(
        "Now click the orange send button to submit.",
        TWO_SENTENCE_TURN,
      ),
    ).toBe(false);
  });

  it("lets short connective sentences through", () => {
    // "Go ahead." appears inside the previous turn, but suppressing every
    // short phrase that happens to recur would silence real instructions.
    for (const short of ["Go ahead.", "Perfect.", "Nice, that's in."]) {
      expect(short.length).toBeLessThan(MIN_REPEAT_CHARS);
      expect(isRepeatedSentence(short, TWO_SENTENCE_TURN)).toBe(false);
    }
  });

  it("says nothing is a repeat when there is no previous instruction", () => {
    // First turn of a session: everything is new.
    expect(isRepeatedSentence("Go ahead and open Claude Desktop now.", "")).toBe(
      false,
    );
  });

  it("bias is toward speaking: a paraphrase is not treated as a repeat", () => {
    // Going silent is the worse failure, so near-misses must speak.
    expect(
      isRepeatedSentence(
        "Click 'Something else' to describe your own task instead.",
        TWO_SENTENCE_TURN,
      ),
    ).toBe(false);
  });
});
