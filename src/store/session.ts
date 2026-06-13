import { create } from "zustand";
import type {
  AppMode,
  CaptureFrame,
  ConversationTurn,
  SessionStatus,
  StepPace,
  UploadedContext,
} from "../lib/api";

export interface SessionState {
  status: SessionStatus;
  mode: AppMode | null;
  goal: string | null;
  currentInstruction: string;
  completedSteps: string[];
  upcomingSteps: string[];
  diverted: boolean;
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
  researchQuery: string | null;

  // Used to avoid speaking / re-rendering the same instruction back-to-back.
  lastSpokenInstruction: string | null;
  // Time the assistant last spoke (any spoken action), used for pacing.
  lastSpokeAt: number | null;
  // Time the last Claude call was made — enforces minimum call spacing.
  lastClaudeCallAt: number | null;
  // Time the screen hash last changed — drives the stall check-in ladder.
  lastScreenChangeAt: number | null;
  // Time of the last check_in, so we don't pester.
  lastCheckInAt: number | null;
  // Expected pace of the current step, from Claude — scales stall patience.
  currentPace: StepPace;
  // Which TTS engine actually spoke last — lets the UI surface degradation
  // to the system voice instead of failing silently.
  lastTtsEngine: "google" | "openai" | "system" | "none" | null;

  setStatus(s: SessionStatus): void;
  setMode(mode: AppMode | null): void;
  setGoal(goal: string): void;
  setInstruction(text: string): void;
  setCompletedSteps(steps: string[]): void;
  setUpcomingSteps(steps: string[]): void;
  setDiverted(val: boolean): void;
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
  setResearchQuery(q: string | null): void;
  setLastSpokenInstruction(s: string | null): void;
  setLastSpokeAt(t: number | null): void;
  setLastClaudeCallAt(t: number | null): void;
  setLastScreenChangeAt(t: number | null): void;
  setLastCheckInAt(t: number | null): void;
  setCurrentPace(p: StepPace): void;
  setLastTtsEngine(e: "google" | "openai" | "system" | "none" | null): void;
  reset(): void;
}

const MAX_FRAMES = 5;

const initial = {
  status: "idle" as SessionStatus,
  mode: null as AppMode | null,
  goal: null,
  currentInstruction: "",
  completedSteps: [] as string[],
  upcomingSteps: [] as string[],
  diverted: false,
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
  researchQuery: null as string | null,
  lastSpokenInstruction: null as string | null,
  lastSpokeAt: null as number | null,
  lastClaudeCallAt: null as number | null,
  lastScreenChangeAt: null as number | null,
  lastCheckInAt: null as number | null,
  currentPace: "medium" as StepPace,
  lastTtsEngine: null as "google" | "openai" | "system" | "none" | null,
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  setStatus: (s) => set({ status: s }),
  setMode: (mode) => set({ mode }),
  setGoal: (goal) => set({ goal }),
  setInstruction: (text) => set({ currentInstruction: text }),
  setCompletedSteps: (steps) => set({ completedSteps: steps }),
  setUpcomingSteps: (steps) => set({ upcomingSteps: steps }),
  setDiverted: (val) => set({ diverted: val }),
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
  setResearchQuery: (q) => set({ researchQuery: q }),
  setLastSpokenInstruction: (s) => set({ lastSpokenInstruction: s }),
  setLastSpokeAt: (t) => set({ lastSpokeAt: t }),
  setLastClaudeCallAt: (t) => set({ lastClaudeCallAt: t }),
  setLastScreenChangeAt: (t) => set({ lastScreenChangeAt: t }),
  setLastCheckInAt: (t) => set({ lastCheckInAt: t }),
  setCurrentPace: (p) => set({ currentPace: p }),
  setLastTtsEngine: (e) => set({ lastTtsEngine: e }),
  reset: () => set({ ...initial }),
}));
