import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiKeyStatus,
  AppMode,
  Clarification,
  CaptureFrame,
  CaptureRegion,
  ClarificationResponse,
  ConversationTurn,
  DisplayInfo,
  GoalEvaluation,
  InstructionResponse,
  SessionPlan,
  Settings,
  TtsEngine,
  TtsVoiceId,
  UploadedContext,
} from "./types";

export interface SightLineApi {
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  keys: {
    status(): Promise<ApiKeyStatus>;
    set(name: "anthropic" | "openai", value: string): Promise<void>;
    clear(name: "anthropic" | "openai"): Promise<void>;
  };
  displays: {
    list(): Promise<DisplayInfo[]>;
  };
  capture: {
    once(displayId: string | null): Promise<CaptureFrame>;
  };
  files: {
    pickContext(): Promise<UploadedContext[]>;
  };
  claude: {
    nextInstruction(args: {
      mode: AppMode;
      goal: string;
      completedSteps: string[];
      conversation: ConversationTurn[];
      frames: CaptureFrame[];
      followUp?: string;
      clarificationContext?: string;
      uploadedContext?: string;
      agentNotes?: string[];
      secondsSinceScreenChange?: number;
      secondsSinceLastSpoke?: number;
      stalled?: boolean;
    }): Promise<
      | InstructionResponse
      | { __error: "missing_api_key" }
      | { __error: "rate_limited"; retryAfterSec: number }
      | { __error: "request_failed"; message: string }
    >;
    getClarifications(args: { mode: AppMode; goal: string }): Promise<
      ClarificationResponse | { __error: string; message?: string }
    >;
    getSessionPlan(args: {
      mode: AppMode;
      goal: string;
      clarifications: Clarification[];
      screenshot?: string;
    }): Promise<SessionPlan | { __error: string; message?: string }>;
    // Fires once per completed sentence of the instruction while Claude's
    // response is still streaming — lets TTS start on the first sentence.
    onSpeechChunk(cb: (chunk: { text: string; index: number }) => void): () => void;
    evaluateGoal(args: {
      mode: AppMode;
      goal: string;
      completedSteps: string[];
      conversation: ConversationTurn[];
      frames: CaptureFrame[];
    }): Promise<GoalEvaluation | { __error: string; message?: string }>;
  };
  whisper: {
    transcribe(args: {
      audioBase64: string;
      mimeType: string;
    }): Promise<{ text: string } | { __error: string; message?: string }>;
  };
  window: {
    setOpacity(opacity: number): Promise<void>;
    setIgnoreMouse(ignore: boolean): Promise<void>;
    setCollapsed(collapsed: boolean): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
  tts: {
    speak(
      text: string,
      voice?: TtsVoiceId,
    ): Promise<
      | { audioBase64: string; engine: TtsEngine }
      | { __error: "missing_openai_key" }
      | { __error: "request_failed"; message: string }
    >;
  };
  research: {
    search(query: string): Promise<{ text: string } | { __error: string; message?: string }>;
  };
  overlay: {
    showGlow(displayId: string | null): Promise<void>;
    hideGlow(): Promise<void>;
    setAdjust(adjust: boolean): Promise<void>;
    onRegionUpdated(cb: (region: CaptureRegion | null) => void): () => void;
  };
  input: {
    onActivity(cb: () => void): () => void;
  };
  app: {
    quit(): Promise<void>;
  };
  log(message: string): void;
}

const api: SightLineApi = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
  },
  keys: {
    status: () => ipcRenderer.invoke("keys:get-status"),
    set: (name, value) => ipcRenderer.invoke("keys:set", { name, value }),
    clear: (name) => ipcRenderer.invoke("keys:clear", { name }),
  },
  displays: {
    list: () => ipcRenderer.invoke("displays:list"),
  },
  capture: {
    once: (displayId) => ipcRenderer.invoke("capture:once", { displayId }),
  },
  files: {
    pickContext: () => ipcRenderer.invoke("files:pick-context"),
  },
  claude: {
    nextInstruction: (args) =>
      ipcRenderer.invoke("claude:next-instruction", args),
    getClarifications: (args) =>
      ipcRenderer.invoke("claude:get-clarifications", args),
    getSessionPlan: (args) =>
      ipcRenderer.invoke("claude:get-session-plan", args),
    onSpeechChunk: (cb) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        chunk: { text: string; index: number },
      ) => cb(chunk);
      ipcRenderer.on("claude:speech-chunk", handler);
      return () => ipcRenderer.removeListener("claude:speech-chunk", handler);
    },
    evaluateGoal: (args) => ipcRenderer.invoke("claude:evaluate-goal", args),
  },
  whisper: {
    transcribe: (args) => ipcRenderer.invoke("whisper:transcribe", args),
  },
  window: {
    setOpacity: (opacity) =>
      ipcRenderer.invoke("window:set-opacity", { opacity }),
    setIgnoreMouse: (ignore) =>
      ipcRenderer.invoke("window:set-ignore-mouse", { ignore }),
    setCollapsed: (collapsed) =>
      ipcRenderer.invoke("window:set-collapsed", { collapsed }),
    openExternal: (url) =>
      ipcRenderer.invoke("window:open-external", { url }),
  },
  tts: {
    speak: (text, voice) => ipcRenderer.invoke("tts:speak", { text, voice }),
  },
  research: {
    search: (query) => ipcRenderer.invoke("research:search", { query }),
  },
  overlay: {
    showGlow: (displayId) => ipcRenderer.invoke("overlay:show-glow", { displayId }),
    hideGlow: () => ipcRenderer.invoke("overlay:hide-glow"),
    setAdjust: (adjust) => ipcRenderer.invoke("overlay:set-adjust", { adjust }),
    onRegionUpdated: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, region: CaptureRegion | null) =>
        cb(region);
      ipcRenderer.on("overlay:region-updated", handler);
      return () => ipcRenderer.removeListener("overlay:region-updated", handler);
    },
  },
  input: {
    onActivity: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("input:activity", handler);
      return () => ipcRenderer.removeListener("input:activity", handler);
    },
  },
  app: {
    quit: () => ipcRenderer.invoke("app:quit"),
  },
  log: (message) => ipcRenderer.send("session:log", message),
};

contextBridge.exposeInMainWorld("sightline", api);
