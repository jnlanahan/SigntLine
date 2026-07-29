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
  ElevenVoiceOption,
  HighlightRect,
  InstructionAction,
  InstructionResponse,
  PushToTalkKey,
  SessionPlan,
  Settings,
  SessionStatus,
  StepPace,
  TtsEngine,
  TtsPlaybackEngine,
  TtsProviderChoice,
  TtsVoiceId,
  UploadedContext,
} from "../../electron/types";

export type { TokenUsage } from "../../electron/usage";
