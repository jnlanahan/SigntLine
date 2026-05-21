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

export interface InstructionResponse {
  instruction: string;
  completedSteps: string[];
  done: boolean;
  needsResearch: boolean;
  researchQuery: string;
}

export interface ClarificationResponse {
  questions: string[];
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

export interface Settings {
  captureIntervalSec: number;
  opacity: number;
  selectedDisplayId: string | null;
  hasSeenPrivacyNotice: boolean;
  ttsEnabled: boolean;
  ttsVoice: TtsVoiceId;
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
  | "claude:next-instruction"
  | "whisper:transcribe"
  | "window:set-opacity"
  | "window:set-ignore-mouse"
  | "window:open-external"
  | "app:quit"
  | "overlay:show-glow"
  | "overlay:hide-glow"
  | "tts:speak"
  | "session:log";
