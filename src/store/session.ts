import { create } from "zustand";
import type {
  CaptureFrame,
  ConversationTurn,
  SessionStatus,
  UploadedContext,
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
  // User-attached reference material (text/markdown), in-session only.
  uploadedContext: string;
  attachedFileNames: string[];
  // Durable notes the agent recorded this session, oldest to newest.
  agentNotes: string[];
  lastProcessedHash: string | null;
  pendingFollowUp: string | null;
  pauseReason: "user" | "idle" | null;
  idleCycles: number;
  researchQuery: string | null;

  // After Claude responds we wait at least this long before re-checking the
  // screen, so the user has time to actually take action.
  cooldownUntil: number | null;
  // Used to avoid speaking / re-rendering the same instruction back-to-back.
  lastSpokenInstruction: string | null;
  // Time of the last assistant response, used to time waiting nudges.
  lastInstructionAt: number | null;
  afterInstructionAlertUntil: number | null;

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
  addUploadedContext(files: UploadedContext[]): void;
  appendAgentNote(note: string): void;
  setLastProcessedHash(h: string | null): void;
  setPendingFollowUp(text: string | null): void;
  setPauseReason(r: "user" | "idle" | null): void;
  incrementIdleCycles(): void;
  resetIdleCycles(): void;
  setResearchQuery(q: string | null): void;
  setCooldownUntil(t: number | null): void;
  setLastSpokenInstruction(s: string | null): void;
  setLastInstructionAt(t: number | null): void;
  setAfterInstructionAlertUntil(t: number | null): void;
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
  uploadedContext: "",
  attachedFileNames: [] as string[],
  agentNotes: [] as string[],
  lastProcessedHash: null as string | null,
  pendingFollowUp: null as string | null,
  pauseReason: null as "user" | "idle" | null,
  idleCycles: 0,
  researchQuery: null as string | null,
  cooldownUntil: null as number | null,
  lastSpokenInstruction: null as string | null,
  lastInstructionAt: null as number | null,
  afterInstructionAlertUntil: null as number | null,
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
  addUploadedContext: (files) =>
    set((state) => {
      const additions = files
        .map((f) => `--- ${f.name} ---\n${f.text}`)
        .join("\n\n");
      return {
        uploadedContext: state.uploadedContext
          ? `${state.uploadedContext}\n\n${additions}`
          : additions,
        attachedFileNames: [
          ...state.attachedFileNames,
          ...files.map((f) => f.name),
        ],
      };
    }),
  appendAgentNote: (note) =>
    set((state) =>
      state.agentNotes.includes(note)
        ? state
        : { agentNotes: [...state.agentNotes, note] },
    ),
  setLastProcessedHash: (h) => set({ lastProcessedHash: h }),
  setPendingFollowUp: (text) => set({ pendingFollowUp: text }),
  setPauseReason: (r) => set({ pauseReason: r }),
  incrementIdleCycles: () => set((s) => ({ idleCycles: s.idleCycles + 1 })),
  resetIdleCycles: () => set({ idleCycles: 0 }),
  setResearchQuery: (q) => set({ researchQuery: q }),
  setCooldownUntil: (t) => set({ cooldownUntil: t }),
  setLastSpokenInstruction: (s) => set({ lastSpokenInstruction: s }),
  setLastInstructionAt: (t) => set({ lastInstructionAt: t }),
  setAfterInstructionAlertUntil: (t) => set({ afterInstructionAlertUntil: t }),
  reset: () => set({ ...initial }),
}));
