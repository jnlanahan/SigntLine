import { create } from "zustand";
import type {
  CaptureFrame,
  ConversationTurn,
  SessionStatus,
} from "../lib/api";

export interface SessionState {
  status: SessionStatus;
  goal: string | null;
  currentInstruction: string;
  completedSteps: string[];
  conversation: ConversationTurn[];
  frames: CaptureFrame[];
  lastError: string | null;
  rateLimitUntil: number | null;
  done: boolean;

  clarificationContext: string;
  lastProcessedHash: string | null;
  pendingFollowUp: string | null;
  pauseReason: "user" | "idle" | null;
  idleCycles: number;
  researchQuery: string | null;

  setStatus(s: SessionStatus): void;
  setGoal(goal: string): void;
  setInstruction(text: string): void;
  setCompletedSteps(steps: string[]): void;
  pushFrame(frame: CaptureFrame): void;
  appendTurn(turn: ConversationTurn): void;
  setError(message: string | null): void;
  setRateLimit(until: number | null): void;
  setDone(done: boolean): void;
  setClarificationContext(ctx: string): void;
  setLastProcessedHash(h: string | null): void;
  setPendingFollowUp(text: string | null): void;
  setPauseReason(r: "user" | "idle" | null): void;
  incrementIdleCycles(): void;
  resetIdleCycles(): void;
  setResearchQuery(q: string | null): void;
  reset(): void;
}

const MAX_FRAMES = 5;

const initial = {
  status: "idle" as SessionStatus,
  goal: null,
  currentInstruction: "",
  completedSteps: [] as string[],
  conversation: [] as ConversationTurn[],
  frames: [] as CaptureFrame[],
  lastError: null,
  rateLimitUntil: null,
  done: false,
  clarificationContext: "",
  lastProcessedHash: null as string | null,
  pendingFollowUp: null as string | null,
  pauseReason: null as "user" | "idle" | null,
  idleCycles: 0,
  researchQuery: null as string | null,
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  setStatus: (s) => set({ status: s }),
  setGoal: (goal) => set({ goal }),
  setInstruction: (text) => set({ currentInstruction: text }),
  setCompletedSteps: (steps) => set({ completedSteps: steps }),
  pushFrame: (frame) =>
    set((state) => ({
      frames: [...state.frames, frame].slice(-MAX_FRAMES),
    })),
  appendTurn: (turn) =>
    set((state) => ({ conversation: [...state.conversation, turn] })),
  setError: (message) => set({ lastError: message }),
  setRateLimit: (until) => set({ rateLimitUntil: until }),
  setDone: (done) => set({ done }),
  setClarificationContext: (ctx) => set({ clarificationContext: ctx }),
  setLastProcessedHash: (h) => set({ lastProcessedHash: h }),
  setPendingFollowUp: (text) => set({ pendingFollowUp: text }),
  setPauseReason: (r) => set({ pauseReason: r }),
  incrementIdleCycles: () => set((s) => ({ idleCycles: s.idleCycles + 1 })),
  resetIdleCycles: () => set({ idleCycles: 0 }),
  setResearchQuery: (q) => set({ researchQuery: q }),
  reset: () => set({ ...initial }),
}));
