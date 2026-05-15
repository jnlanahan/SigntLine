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
  // Rolling buffer — last 5 frames, kept in-memory only.
  frames: CaptureFrame[];
  lastError: string | null;
  rateLimitUntil: number | null;
  done: boolean;

  setStatus(s: SessionStatus): void;
  setGoal(goal: string): void;
  setInstruction(text: string): void;
  setCompletedSteps(steps: string[]): void;
  pushFrame(frame: CaptureFrame): void;
  appendTurn(turn: ConversationTurn): void;
  setError(message: string | null): void;
  setRateLimit(until: number | null): void;
  setDone(done: boolean): void;
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
  reset: () => set({ ...initial }),
}));
