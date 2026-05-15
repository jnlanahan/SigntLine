import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import * as path from "node:path";
import { loadSettings, saveSettings } from "./settings-store";
import { captureFrame, listDisplays } from "./capture";
import {
  clearKey,
  hasKey,
  setKey,
  type CredentialKey,
} from "./credentials";
import {
  getNextInstruction,
  MissingApiKeyError,
  RateLimitError,
} from "./claude";
import { MissingOpenAIKeyError, transcribe } from "./whisper";
import type { CaptureFrame, ConversationTurn } from "./types";

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: 380,
    height: 520,
    minWidth: 320,
    minHeight: 380,
    x: undefined,
    y: undefined,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    title: "SightLine",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setOpacity(settings.opacity);

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function registerIpc() {
  ipcMain.handle("settings:get", () => loadSettings());

  ipcMain.handle(
    "settings:set",
    (_e: IpcMainInvokeEvent, patch: Record<string, unknown>) => {
      const next = saveSettings(patch);
      if (mainWindow && typeof patch.opacity === "number") {
        mainWindow.setOpacity(next.opacity);
      }
      return next;
    },
  );

  ipcMain.handle("keys:get-status", async () => ({
    anthropic: await hasKey("anthropic"),
    openai: await hasKey("openai"),
  }));

  ipcMain.handle(
    "keys:set",
    async (
      _e: IpcMainInvokeEvent,
      payload: { name: CredentialKey; value: string },
    ) => {
      await setKey(payload.name, payload.value);
    },
  );

  ipcMain.handle(
    "keys:clear",
    async (_e: IpcMainInvokeEvent, payload: { name: CredentialKey }) => {
      await clearKey(payload.name);
    },
  );

  ipcMain.handle("displays:list", () => listDisplays());

  ipcMain.handle(
    "capture:once",
    async (_e: IpcMainInvokeEvent, payload: { displayId: string | null }) => {
      return await captureFrame(payload.displayId ?? null);
    },
  );

  ipcMain.handle(
    "claude:next-instruction",
    async (
      _e: IpcMainInvokeEvent,
      args: {
        goal: string;
        completedSteps: string[];
        conversation: ConversationTurn[];
        frames: CaptureFrame[];
        followUp?: string;
      },
    ) => {
      try {
        return await getNextInstruction(args);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          return { __error: "missing_api_key" } as const;
        }
        if (err instanceof RateLimitError) {
          return {
            __error: "rate_limited",
            retryAfterSec: err.retryAfterSec,
          } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "whisper:transcribe",
    async (
      _e: IpcMainInvokeEvent,
      args: { audioBase64: string; mimeType: string },
    ) => {
      try {
        const text = await transcribe(args);
        return { text };
      } catch (err) {
        if (err instanceof MissingOpenAIKeyError) {
          return { __error: "missing_openai_key" } as const;
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "window:set-opacity",
    (_e: IpcMainInvokeEvent, payload: { opacity: number }) => {
      if (!mainWindow) return;
      const clamped = Math.max(0.25, Math.min(1, payload.opacity));
      mainWindow.setOpacity(clamped);
    },
  );

  ipcMain.handle(
    "window:set-ignore-mouse",
    (_e: IpcMainInvokeEvent, payload: { ignore: boolean }) => {
      if (!mainWindow) return;
      mainWindow.setIgnoreMouseEvents(payload.ignore, { forward: true });
    },
  );

  ipcMain.handle(
    "window:open-external",
    async (_e: IpcMainInvokeEvent, payload: { url: string }) => {
      if (!/^https?:\/\//i.test(payload.url)) return;
      await shell.openExternal(payload.url);
    },
  );

  ipcMain.on("session:log", (_e, message: string) => {
    console.log("[renderer]", message);
  });
}
