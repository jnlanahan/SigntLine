import { contextBridge, ipcRenderer } from "electron";
import type {
  ApiKeyStatus,
  CaptureFrame,
  ClarificationResponse,
  ConversationTurn,
  DisplayInfo,
  InstructionResponse,
  Settings,
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
  claude: {
    nextInstruction(args: {
      goal: string;
      completedSteps: string[];
      conversation: ConversationTurn[];
      frames: CaptureFrame[];
      followUp?: string;
      clarificationContext?: string;
    }): Promise<
      | InstructionResponse
      | { __error: "missing_api_key" }
      | { __error: "rate_limited"; retryAfterSec: number }
      | { __error: "request_failed"; message: string }
    >;
    getClarifications(args: { goal: string }): Promise<
      ClarificationResponse | { __error: string; message?: string }
    >;
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
    openExternal(url: string): Promise<void>;
  };
  tts: {
    speak(text: string): Promise<
      | { audioBase64: string }
      | { __error: "missing_openai_key" }
      | { __error: "request_failed"; message: string }
    >;
  };
  overlay: {
    showGlow(displayId: string | null): Promise<void>;
    hideGlow(): Promise<void>;
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
  claude: {
    nextInstruction: (args) =>
      ipcRenderer.invoke("claude:next-instruction", args),
    getClarifications: (args) =>
      ipcRenderer.invoke("claude:get-clarifications", args),
  },
  whisper: {
    transcribe: (args) => ipcRenderer.invoke("whisper:transcribe", args),
  },
  window: {
    setOpacity: (opacity) =>
      ipcRenderer.invoke("window:set-opacity", { opacity }),
    setIgnoreMouse: (ignore) =>
      ipcRenderer.invoke("window:set-ignore-mouse", { ignore }),
    openExternal: (url) =>
      ipcRenderer.invoke("window:open-external", { url }),
  },
  tts: {
    speak: (text) => ipcRenderer.invoke("tts:speak", { text }),
  },
  overlay: {
    showGlow: (displayId) => ipcRenderer.invoke("overlay:show-glow", { displayId }),
    hideGlow: () => ipcRenderer.invoke("overlay:hide-glow"),
  },
  app: {
    quit: () => ipcRenderer.invoke("app:quit"),
  },
  log: (message) => ipcRenderer.send("session:log", message),
};

contextBridge.exposeInMainWorld("sightline", api);
