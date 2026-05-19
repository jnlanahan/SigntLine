import type { SightLineApi } from "../../electron/preload";

declare global {
  interface Window {
    sightline: SightLineApi;
  }
}

export const api = (): SightLineApi => window.sightline;

export type {
  ApiKeyStatus,
  CaptureFrame,
  ClarificationResponse,
  ConversationTurn,
  DisplayInfo,
  InstructionResponse,
  Settings,
  SessionStatus,
} from "../../electron/types";
