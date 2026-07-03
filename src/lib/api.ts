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
  CaptureTarget,
  ClarificationQuestion,
  ClarificationResponse,
  ConversationTurn,
  DisplayInfo,
  DockSide,
  DockState,
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
