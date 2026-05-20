import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadSettings, saveSettings } from "./settings-store";
import { captureFrame, listDisplays } from "./capture";
import {
  clearKey,
  hasKey,
  setKey,
  type CredentialKey,
} from "./credentials";
import {
  getClarifications,
  getNextInstruction,
  MissingApiKeyError,
  RateLimitError,
} from "./claude";
import { MissingOpenAIKeyError, transcribe } from "./whisper";
import { speakText, type TtsVoice } from "./openai-tts";
import { hasGoogleCredentials, speakTextGoogle } from "./google-tts";
import type { CaptureFrame, ConversationTurn } from "./types";

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const isDev = !app.isPackaged;

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val) result[key] = val;
  }
  return result;
}

async function loadKeysFromEnv() {
  const envPaths = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "../.env"),
    path.join(app.getPath("userData"), ".env"),
  ];
  let envVars: Record<string, string> = {};
  for (const p of envPaths) {
    try {
      envVars = parseEnvFile(fs.readFileSync(p, "utf-8"));
      break;
    } catch { /* not found */ }
  }
  if (envVars.ANTHROPIC_API_KEY) {
    await setKey("anthropic", envVars.ANTHROPIC_API_KEY);
    process.env.ANTHROPIC_API_KEY = envVars.ANTHROPIC_API_KEY;
  }
  if (envVars.OPENAI_API_KEY) {
    await setKey("openai", envVars.OPENAI_API_KEY);
    process.env.OPENAI_API_KEY = envVars.OPENAI_API_KEY;
  }
  if (envVars.GOOGLE_PROJECT_ID) process.env.GOOGLE_PROJECT_ID = envVars.GOOGLE_PROJECT_ID;
  if (envVars.GOOGLE_CLIENT_EMAIL) process.env.GOOGLE_CLIENT_EMAIL = envVars.GOOGLE_CLIENT_EMAIL;
  if (envVars.GOOGLE_PRIVATE_KEY) process.env.GOOGLE_PRIVATE_KEY = envVars.GOOGLE_PRIVATE_KEY;
}

let mainWindow: BrowserWindow | null = null;
let glowWindow: BrowserWindow | null = null;

const GLOW_HTML = `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0}
html,body{width:100vw;height:100vh;overflow:hidden;background:transparent}
.g{position:fixed;inset:0;border:4px solid rgba(99,102,241,0.9);
box-shadow:inset 0 0 70px 20px rgba(99,102,241,0.28),0 0 70px 20px rgba(99,102,241,0.28);
animation:p 2.8s ease-in-out infinite}
@keyframes p{0%,100%{opacity:0.45}50%{opacity:1}}
</style></head><body><div class="g"></div></body></html>`;

function showGlowOverlay(displayId: string | null) {
  if (glowWindow && !glowWindow.isDestroyed()) {
    glowWindow.close();
    glowWindow = null;
  }

  const all = screen.getAllDisplays();
  const target =
    (displayId ? all.find((d) => String(d.id) === displayId) : null) ??
    screen.getPrimaryDisplay();

  const { x, y, width, height } = target.bounds;

  glowWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  glowWindow.setIgnoreMouseEvents(true, { forward: true });
  glowWindow.setAlwaysOnTop(true, "screen-saver");
  glowWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  void glowWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(GLOW_HTML)}`,
  );

  glowWindow.on("closed", () => { glowWindow = null; });
}

function hideGlowOverlay() {
  if (glowWindow && !glowWindow.isDestroyed()) {
    glowWindow.close();
    glowWindow = null;
  }
}

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
      preload: path.join(__dirname, "preload.mjs"),
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
    hideGlowOverlay();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await loadKeysFromEnv();
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
      e: IpcMainInvokeEvent,
      args: {
        goal: string;
        completedSteps: string[];
        conversation: ConversationTurn[];
        frames: CaptureFrame[];
        followUp?: string;
        clarificationContext?: string;
      },
    ) => {
      try {
        return await getNextInstruction(args, (instruction) => {
          if (!e.sender.isDestroyed()) {
            e.sender.send("claude:instruction-ready", instruction);
          }
        });
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
    "claude:get-clarifications",
    async (_e: IpcMainInvokeEvent, args: { goal: string }) => {
      try {
        return await getClarifications(args);
      } catch (err) {
        if (err instanceof MissingApiKeyError) {
          return { __error: "missing_api_key" } as const;
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

  ipcMain.handle("app:quit", () => {
    app.quit();
  });

  ipcMain.handle(
    "research:search",
    async (_e: IpcMainInvokeEvent, payload: { query: string }) => {
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(payload.query)}&format=json&no_html=1&skip_disambig=1`;
        const resp = await fetch(url, { headers: { "User-Agent": "SightLine/0.1.0" } });
        const data = await resp.json() as {
          AbstractText?: string;
          Answer?: string;
          RelatedTopics?: Array<{ Text?: string } | { Topics?: unknown[] }>;
        };
        const parts: string[] = [];
        if (data.Answer) parts.push(data.Answer);
        if (data.AbstractText) parts.push(data.AbstractText);
        if (Array.isArray(data.RelatedTopics)) {
          for (const t of data.RelatedTopics.slice(0, 5)) {
            if ("Text" in t && t.Text) parts.push(t.Text);
          }
        }
        return { text: parts.join("\n\n") };
      } catch (err) {
        return { __error: "fetch_failed", message: String(err) };
      }
    },
  );

  ipcMain.handle(
    "tts:speak",
    async (
      _e: IpcMainInvokeEvent,
      payload: { text: string; voice?: TtsVoice },
    ) => {
      try {
        let buffer: Buffer;
        if (hasGoogleCredentials()) {
          console.log("[SightLine TTS] Using Google Studio voice");
          buffer = await speakTextGoogle(payload.text, payload.voice);
        } else {
          console.log("[SightLine TTS] Using OpenAI voice");
          buffer = await speakText(payload.text, { voice: payload.voice });
        }
        return { audioBase64: buffer.toString("base64") };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("missing_openai_key") || msg.includes("missing_google_credentials")) {
          return { __error: "missing_openai_key" } as const;
        }
        return { __error: "request_failed", message: msg } as const;
      }
    },
  );

  ipcMain.handle(
    "overlay:show-glow",
    (_e: IpcMainInvokeEvent, payload: { displayId: string | null }) => {
      showGlowOverlay(payload.displayId ?? null);
    },
  );

  ipcMain.handle("overlay:hide-glow", () => {
    hideGlowOverlay();
  });

  ipcMain.on("session:log", (_e, message: string) => {
    console.log("[renderer]", message);
  });
}
