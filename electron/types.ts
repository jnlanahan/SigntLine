export type AppMode = "tech_support" | "training" | "teacher";

export type SessionStatus =
  | "idle"
  | "watching"
  | "thinking"
  | "waiting"
  | "paused"
  | "error"
  | "clarifying"
  | "researching";

export interface CompletedStep {
  index: number;
  description: string;
  timestamp: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface CaptureFrame {
  // base64-encoded PNG, kept in-memory only
  dataUrl: string;
  timestamp: number;
  width: number;
  height: number;
}

// A sub-region of a display to capture, in display-relative DIP coordinates
// (origin at the display's top-left). null means capture the whole display.
export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InstructionResponse {
  instruction: string;
  completedSteps: string[];
  upcomingSteps: string[];
  digression: boolean;
  done: boolean;
  needsResearch: boolean;
  researchQuery: string;
  notes: string;
}

export interface UploadedContext {
  name: string;
  text: string;
}

export interface Clarification {
  question: string;
  answer: string;
}

export interface ClarificationQuestion {
  question: string;
  options: string[];
}

export interface ClarificationResponse {
  questions: ClarificationQuestion[];
}

export interface SessionPlan {
  overview: string;
  steps: string[];
}

export type TtsVoiceId =
  | "alloy"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "shimmer"
  | "coral"
  | "sage";

export type AccentName = "lime" | "cobalt" | "rose" | "slate";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  captureIntervalSec: number;
  opacity: number;
  selectedDisplayId: string | null;
  captureRegion: CaptureRegion | null;
  hasSeenPrivacyNotice: boolean;
  ttsEnabled: boolean;
  ttsVoice: TtsVoiceId;
  accentColor: AccentName;
  windowBounds: WindowBounds | null;
}

export interface DisplayInfo {
  id: string;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface ApiKeyStatus {
  anthropic: boolean;
  openai: boolean;
}

export type IpcChannel =
  | "settings:get"
  | "settings:set"
  | "keys:get-status"
  | "keys:set"
  | "keys:clear"
  | "displays:list"
  | "capture:once"
  | "files:pick-context"
  | "claude:next-instruction"
  | "claude:get-session-plan"
  | "whisper:transcribe"
  | "window:set-opacity"
  | "window:set-ignore-mouse"
  | "window:open-external"
  | "app:quit"
  | "overlay:show-glow"
  | "overlay:hide-glow"
  | "overlay:set-adjust"
  | "overlay:commit-region"
  | "overlay:cancel-adjust"
  | "tts:speak"
  | "session:log";
