import { describe, expect, it } from "vitest";
import {
  buildSessionRecord,
  deriveOutcome,
  isWorthSaving,
  type SessionSnapshot,
} from "../lib/sessionRecord";
import { EMPTY_USAGE } from "../../electron/usage";
import type { ConversationTurn } from "../lib/api";

const START = 1_800_000_000_000;
const END = START + 10 * 60 * 1000;

function turn(role: "user" | "assistant", content: string): ConversationTurn {
  return { role, content, timestamp: START + 1000 };
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: "sess_test",
    mode: "tech_support",
    goal: "Set up a VPN",
    startedAt: START,
    endedAt: END,
    done: false,
    verdict: null,
    completedSteps: [],
    currentInstruction: "",
    upcomingSteps: [],
    conversation: [],
    usage: { ...EMPTY_USAGE },
    costUsd: 0,
    claudeCalls: 0,
    ...overrides,
  };
}

describe("deriveOutcome", () => {
  it("is completed when the coach declared the goal met", () => {
    expect(
      deriveOutcome({ done: true, completedSteps: [], conversation: [] }),
    ).toBe("completed");
  });

  it("is abandoned when real work happened but never finished", () => {
    expect(
      deriveOutcome({
        done: false,
        completedSteps: ["Downloaded the client"],
        conversation: [],
      }),
    ).toBe("abandoned");
  });

  it("is unknown when nothing happened at all", () => {
    // Opening the app and closing it is not a failed session.
    expect(
      deriveOutcome({ done: false, completedSteps: [], conversation: [] }),
    ).toBe("unknown");
  });

  it("counts an assistant reply as real activity", () => {
    expect(
      deriveOutcome({
        done: false,
        completedSteps: [],
        conversation: [turn("assistant", "Click the gear icon.")],
      }),
    ).toBe("abandoned");
  });

  it("does not count the user's own opening message as activity", () => {
    expect(
      deriveOutcome({
        done: false,
        completedSteps: [],
        conversation: [turn("user", "Goal: Set up a VPN")],
      }),
    ).toBe("unknown");
  });
});

describe("buildSessionRecord", () => {
  it("carries the totals the history list reads", () => {
    const record = buildSessionRecord(
      snapshot({
        costUsd: 0.42,
        claudeCalls: 17,
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 400,
        },
      }),
    );
    expect(record.costUsd).toBe(0.42);
    expect(record.claudeCalls).toBe(17);
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(200);
    expect(record.cacheReadTokens).toBe(300);
    expect(record.cacheWriteTokens).toBe(400);
  });

  it("leaves userId null until auth exists", () => {
    expect(buildSessionRecord(snapshot()).userId).toBeNull();
  });

  it("drops the synthetic opening Goal turn from the transcript", () => {
    const record = buildSessionRecord(
      snapshot({
        conversation: [
          turn("user", "Goal: Set up a VPN"),
          turn("assistant", "Go ahead and open Settings."),
        ],
      }),
    );
    expect(record.turns).toHaveLength(1);
    expect(record.turns[0].role).toBe("assistant");
  });

  it("keeps a real user message that merely mentions a goal", () => {
    const record = buildSessionRecord(
      snapshot({ conversation: [turn("user", "My goal here is unclear")] }),
    );
    expect(record.turns).toHaveLength(1);
  });

  it("numbers turns contiguously after filtering", () => {
    const record = buildSessionRecord(
      snapshot({
        conversation: [
          turn("user", "Goal: Set up a VPN"),
          turn("assistant", "First step."),
          turn("user", "Done."),
          turn("assistant", "Second step."),
        ],
      }),
    );
    expect(record.turns.map((t) => t.idx)).toEqual([0, 1, 2]);
  });

  it("records completed, current, and upcoming steps in order", () => {
    const record = buildSessionRecord(
      snapshot({
        completedSteps: ["Downloaded the client", "Created an account"],
        currentInstruction: "Now connect to a server",
        upcomingSteps: ["Verify the connection"],
      }),
    );
    expect(record.steps.map((s) => s.state)).toEqual([
      "completed",
      "completed",
      "current",
      "upcoming",
    ]);
    expect(record.steps.map((s) => s.idx)).toEqual([0, 1, 2, 3]);
  });

  it("does not record a current step when the session finished", () => {
    const record = buildSessionRecord(
      snapshot({
        done: true,
        completedSteps: ["Everything"],
        currentInstruction: "Nice work, you're all set.",
      }),
    );
    expect(record.steps.every((s) => s.state === "completed")).toBe(true);
  });

  it("preserves the evaluation verdict", () => {
    const record = buildSessionRecord(
      snapshot({ verdict: "The VPN is connected and showing a green status." }),
    );
    expect(record.verdict).toContain("green status");
  });

  it("keeps the wall-clock duration", () => {
    const record = buildSessionRecord(snapshot());
    expect(record.endedAt! - record.startedAt).toBe(10 * 60 * 1000);
  });
});

describe("isWorthSaving", () => {
  it("skips a session where nothing happened", () => {
    expect(isWorthSaving(buildSessionRecord(snapshot()))).toBe(false);
  });

  it("saves a session that produced any conversation", () => {
    const record = buildSessionRecord(
      snapshot({ conversation: [turn("assistant", "Click here.")] }),
    );
    expect(isWorthSaving(record)).toBe(true);
  });

  it("saves a session that made step progress", () => {
    const record = buildSessionRecord(
      snapshot({ completedSteps: ["Downloaded the client"] }),
    );
    expect(isWorthSaving(record)).toBe(true);
  });
});
