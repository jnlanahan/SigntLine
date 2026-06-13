import type { SightLineApi } from "../../electron/preload";

declare global {
  interface Window {
    sightline: SightLineApi;
  }
}

export const api = (): SightLineApi => window.sightline;

export type {
  AccentName,
  ApiKeyStatus,
  AppMode,
  Clarification,
  CaptureFrame,
  CaptureRegion,
  ClarificationQuestion,
  ClarificationResponse,
  ConversationTurn,
  DisplayInfo,
  InstructionAction,
  InstructionResponse,
  SessionPlan,
  Settings,
  SessionStatus,
  StepPace,
  TtsEngine,
  TtsVoiceId,
  UploadedContext,
} from "../../electron/types";
