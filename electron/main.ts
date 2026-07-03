import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadSettings, saveSettings } from "./settings-store";
import { captureFrame, listCaptureTargets, listDisplays } from "./capture";
import {
  getCalibration,
  initCalibration,
  invalidateCalibration,
} from "./calibrate";
import {
  dockWindow,
  undockWindow,
  updateDockWidth,
  isDocked,
  isDockingAvailable,
  getDockRectDip,
  setDockChangeListener,
} from "./dock";
import { clampDockWidth, RAIL_WIDTH, subtractDockStrip } from "./dock-geometry";
import {
  clearKey,
  hasKey,
  setKey,
  type CredentialKey,
} from "./credentials";
import {
  getClarifications,
  getGoalEvaluation,
  getNextInstruction,
  getSessionPlan,
  MissingApiKeyError,
  RateLimitError,
} from "./claude";
import { MissingOpenAIKeyError, transcribe } from "./whisper";
import { speakText, type TtsVoice } from "./openai-tts";
import { hasGoogleCredentials, speakTextGoogle } from "./google-tts";
import type { AppMode, Clarification, CaptureFrame, ConversationTurn, UploadedContext } from "./types";
import { uIOhook } from "uiohook-napi";

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
const isDev = !app.isPackaged;

// Reject a promise that runs past `ms`. Used to bound external calls (TTS
// engines) so one hung request can't wedge a whole feature.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(label)), ms),
    ),
  ]);
}

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
// Collapse-to-bar state: remember the expanded size while collapsed, and
// stop bounds persistence from saving the collapsed stub size.
let expandedSize: { width: number; height: number } | null = null;
let isCollapsed = false;
// Whether the renderer asked to be docked. Survives an involuntary undock
// (docked monitor unplugged) so we can redock once a watched display exists.
let wantsDock = false;
let redockTimer: ReturnType<typeof setTimeout> | null = null;
let tray: Tray | null = null;
let glowAdjusting = false;
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Manual window dragging. CSS -webkit-app-region: drag is unreliable for
// transparent frameless windows on Windows, so the renderer reports
// drag-start/end and we follow the cursor from the main process.
let dragInterval: ReturnType<typeof setInterval> | null = null;
// A real drag never lasts this long — hard stop so a missed pointerup can
// never leave the window glued to the cursor ("floating down the screen").
const DRAG_WATCHDOG_MS = 20_000;

function startWindowDrag() {
  // A docked appbar owns its position — manual dragging would tear the
  // window off the reserved strip.
  if (!mainWindow || mainWindow.isDestroyed() || dragInterval || isDocked()) return;
  const cursorStart = screen.getCursorScreenPoint();
  const [winX, winY] = mainWindow.getPosition();
  const startedAt = Date.now();
  dragInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopWindowDrag();
      return;
    }
    if (Date.now() - startedAt > DRAG_WATCHDOG_MS) {
      console.warn("[drag] watchdog stop — pointerup was never delivered");
      stopWindowDrag();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    mainWindow.setPosition(
      winX + (cursor.x - cursorStart.x),
      winY + (cursor.y - cursorStart.y),
    );
  }, 12);
}

function stopWindowDrag() {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
}

// Accent palette for the glow overlay — mirrors src/design/theme.ts ACCENTS.
const GLOW_ACCENTS: Record<string, { hex: string; rgb: string }> = {
  lime: { hex: "#8FBE2E", rgb: "143,190,46" },
  cobalt: { hex: "#4F8BF2", rgb: "79,139,242" },
  rose: { hex: "#FF6B81", rgb: "255,107,129" },
  slate: { hex: "#9FB2C8", rgb: "159,178,200" },
};

function currentGlowAccent(): { hex: string; rgb: string } {
  return GLOW_ACCENTS[loadSettings().accentColor] ?? GLOW_ACCENTS.lime;
}

// The glow overlay renders an always-visible highlighted box marking the
// capture region. In "adjust" mode the box becomes draggable/resizable so the
// user can pick exactly what gets captured (e.g. one application window).
// Colors follow the user's accent so the box visibly belongs to SightLine.
const buildGlowHtml = (accent: { hex: string; rgb: string }) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;user-select:none}
html,body{width:100vw;height:100vh;overflow:hidden;background:transparent;
font-family:system-ui,-apple-system,Segoe UI,sans-serif}
#root{position:fixed;inset:0}
#box{position:fixed;border:4px solid rgba(${accent.rgb},0.9);
box-shadow:inset 0 0 70px 20px rgba(${accent.rgb},0.28),0 0 70px 20px rgba(${accent.rgb},0.28);
animation:pulse 2.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:0.5}50%{opacity:1}}
.handle{position:absolute;width:16px;height:16px;background:#fff;
border:2px solid rgba(${accent.rgb},1);border-radius:3px;display:none}
#toolbar{position:fixed;left:50%;top:18px;transform:translateX(-50%);
display:none;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;
background:rgba(17,17,23,0.92);border:1px solid rgba(${accent.rgb},0.5);
color:#e5e7eb;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,0.5)}
#toolbar button{font:inherit;cursor:pointer;border-radius:6px;padding:5px 10px;border:0}
#size{color:rgba(${accent.rgb},0.95);font-variant-numeric:tabular-nums;min-width:96px;text-align:center}
.btn-primary{background:${accent.hex};color:#111}
.btn-ghost{background:transparent;color:#cbd5e1;border:1px solid rgba(255,255,255,0.18)!important}
/* view mode: pure visual border, fully click-through */
#root[data-mode="view"] #box{pointer-events:none}
/* adjust mode: dim everything outside the box, show handles + toolbar */
#root[data-mode="adjust"] #box{cursor:move;animation:none;
box-shadow:0 0 0 100000px rgba(0,0,0,0.5),inset 0 0 60px 12px rgba(${accent.rgb},0.35)}
#root[data-mode="adjust"] .handle{display:block}
#root[data-mode="adjust"] #toolbar{display:flex}
.h-nw{top:-8px;left:-8px;cursor:nwse-resize}
.h-n{top:-8px;left:calc(50% - 8px);cursor:ns-resize}
.h-ne{top:-8px;right:-8px;cursor:nesw-resize}
.h-e{top:calc(50% - 8px);right:-8px;cursor:ew-resize}
.h-se{bottom:-8px;right:-8px;cursor:nwse-resize}
.h-s{bottom:-8px;left:calc(50% - 8px);cursor:ns-resize}
.h-sw{bottom:-8px;left:-8px;cursor:nesw-resize}
.h-w{top:calc(50% - 8px);left:-8px;cursor:ew-resize}
</style></head><body>
<div id="root" data-mode="view">
  <div id="box" data-handle="move">
    <div class="handle h-nw" data-handle="nw"></div>
    <div class="handle h-n" data-handle="n"></div>
    <div class="handle h-ne" data-handle="ne"></div>
    <div class="handle h-e" data-handle="e"></div>
    <div class="handle h-se" data-handle="se"></div>
    <div class="handle h-s" data-handle="s"></div>
    <div class="handle h-sw" data-handle="sw"></div>
    <div class="handle h-w" data-handle="w"></div>
  </div>
  <div id="toolbar">
    <span>Drag to set the capture area</span>
    <span id="size"></span>
    <button id="full" class="btn-ghost" type="button">Full screen</button>
    <button id="cancel" class="btn-ghost" type="button">Cancel</button>
    <button id="done" class="btn-primary" type="button">Done</button>
  </div>
</div>
<script>
(function(){
  var api = window.glowApi;
  var MIN = 80;
  var mode = "view";
  var region = null; // {x,y,width,height} | null (null = full screen)
  var root = document.getElementById("root");
  var box = document.getElementById("box");
  var sizeLabel = document.getElementById("size");

  function bounds(){ return { w: window.innerWidth, h: window.innerHeight }; }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function current(){
    if (region) return region;
    var b = bounds();
    return { x:0, y:0, width:b.w, height:b.h };
  }
  function render(){
    var r = current();
    box.style.left = r.x + "px";
    box.style.top = r.y + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    root.dataset.mode = mode;
    sizeLabel.textContent = Math.round(r.width) + " × " + Math.round(r.height);
  }

  var drag = null;
  root.addEventListener("pointerdown", function(e){
    if (mode !== "adjust") return;
    var handle = e.target && e.target.dataset ? e.target.dataset.handle : null;
    if (!handle) return;
    e.preventDefault();
    region = current();
    drag = { handle: handle, sx: e.clientX, sy: e.clientY, orig: {
      x: region.x, y: region.y, width: region.width, height: region.height } };
    try { root.setPointerCapture(e.pointerId); } catch(_) {}
  });
  root.addEventListener("pointermove", function(e){
    if (!drag) return;
    var b = bounds();
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    var o = drag.orig, H = drag.handle;
    var x = o.x, y = o.y, w = o.width, h = o.height;
    var right = o.x + o.width, bottom = o.y + o.height;
    if (H === "move"){
      x = clamp(o.x + dx, 0, b.w - o.width);
      y = clamp(o.y + dy, 0, b.h - o.height);
    } else {
      if (H.indexOf("w") !== -1){ var nx = clamp(o.x + dx, 0, right - MIN); w = right - nx; x = nx; }
      if (H.indexOf("e") !== -1){ var nr = clamp(right + dx, o.x + MIN, b.w); w = nr - x; }
      if (H.indexOf("n") !== -1){ var ny = clamp(o.y + dy, 0, bottom - MIN); h = bottom - ny; y = ny; }
      if (H.indexOf("s") !== -1){ var nb = clamp(bottom + dy, o.y + MIN, b.h); h = nb - y; }
    }
    region = { x: x, y: y, width: w, height: h };
    render();
  });
  function endDrag(e){ if (drag){ drag = null; try { root.releasePointerCapture(e.pointerId); } catch(_) {} } }
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);

  document.getElementById("full").addEventListener("click", function(){ region = null; render(); });
  document.getElementById("done").addEventListener("click", function(){ api.commit(region); });
  document.getElementById("cancel").addEventListener("click", function(){ api.cancel(); });
  window.addEventListener("keydown", function(e){
    if (mode !== "adjust") return;
    if (e.key === "Escape") api.cancel();
    if (e.key === "Enter") api.commit(region);
  });
  window.addEventListener("resize", render);

  api.onSetMode(function(payload){
    mode = payload.mode;
    region = payload.region || null;
    render();
  });
  render();
})();
</script>
</body></html>`;

function getGlowDisplay(displayId: string | null) {
  const all = screen.getAllDisplays();
  return (
    (displayId ? all.find((d) => String(d.id) === displayId) : null) ??
    screen.getPrimaryDisplay()
  );
}

function broadcastGlowMode() {
  if (!glowWindow || glowWindow.isDestroyed()) return;
  glowWindow.webContents.send("glow:set-mode", {
    mode: glowAdjusting ? "adjust" : "view",
    region: loadSettings().captureRegion ?? null,
  });
}

function showGlowOverlay(displayId: string | null) {
  if (glowWindow && !glowWindow.isDestroyed()) {
    glowWindow.close();
    glowWindow = null;
  }
  glowAdjusting = false;

  const target = getGlowDisplay(displayId);
  // While docked on this display the glow outlines the remaining desktop —
  // the sidebar's strip is excluded from capture, so it's excluded from the
  // "what I'm watching" box too.
  const dock = getDockRectDip();
  const area =
    dock && dock.displayId === String(target.id)
      ? subtractDockStrip(target.bounds, dock.rect)
      : target.bounds;
  const { x, y, width, height } = area;

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
      preload: path.join(__dirname, "glow-preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  glowWindow.setIgnoreMouseEvents(true, { forward: true });
  glowWindow.setAlwaysOnTop(true, "screen-saver");
  glowWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  glowWindow.webContents.on("did-finish-load", () => broadcastGlowMode());

  void glowWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildGlowHtml(currentGlowAccent()))}`,
  );

  glowWindow.on("closed", () => { glowWindow = null; });
}

// The display id the glow should sit on = the display of the screen that is
// ACTUALLY captured. Pinned source wins (via pixel-verified calibration);
// stored displayId and primary are fallbacks.
async function resolveWatchedDisplayId(): Promise<string | null> {
  const s = loadSettings();
  try {
    const cal = await getCalibration();
    if (s.selectedSourceId) {
      const d = cal.sourceToDisplay.get(s.selectedSourceId);
      if (d) return d;
    }
    if (s.selectedSourceName) {
      const d = cal.nameToDisplay.get(s.selectedSourceName);
      if (d) return d;
    }
  } catch (err) {
    console.warn("[glow] calibration unavailable, using stored display:", err);
  }
  if (s.selectedDisplayId) return s.selectedDisplayId;
  return String(screen.getPrimaryDisplay().id);
}

// Dock the panel to the watched monitor — the one actually captured — so the
// coach sits beside the work it's coaching through.
async function dockToWatchedDisplay(): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const s = loadSettings();
  const watchedId = await resolveWatchedDisplayId();
  const display =
    screen.getAllDisplays().find((d) => String(d.id) === watchedId) ??
    screen.getPrimaryDisplay();
  const ok = dockWindow(
    mainWindow,
    display,
    s.dockSide,
    clampDockWidth(s.dockWidth),
  );
  if (ok) mainWindow.setOpacity(1);
  return ok;
}

function hideGlowOverlay() {
  if (glowWindow && !glowWindow.isDestroyed()) {
    glowWindow.close();
    glowWindow = null;
  }
  glowAdjusting = false;
}

async function setGlowAdjust(adjust: boolean) {
  if (!glowWindow || glowWindow.isDestroyed()) {
    showGlowOverlay(await resolveWatchedDisplayId());
  }
  if (!glowWindow) return;
  glowAdjusting = adjust;
  if (adjust) {
    glowWindow.setIgnoreMouseEvents(false);
    glowWindow.setFocusable(true);
    glowWindow.focus();
  } else {
    glowWindow.setIgnoreMouseEvents(true, { forward: true });
    glowWindow.setFocusable(false);
  }
  broadcastGlowMode();
}

// Clamp a proposed region to the display and treat a (near-)full-screen
// selection as "no region" so capture falls back to the whole display.
function normalizeRegion(
  region: { x: number; y: number; width: number; height: number } | null,
  displayId: string | null,
): { x: number; y: number; width: number; height: number } | null {
  if (!region) return null;
  const { width: dw, height: dh } = getGlowDisplay(displayId).size;
  const x = Math.max(0, Math.min(region.x, dw));
  const y = Math.max(0, Math.min(region.y, dh));
  const width = Math.max(1, Math.min(region.width, dw - x));
  const height = Math.max(1, Math.min(region.height, dh - y));
  const coversFull =
    x <= 2 && y <= 2 && width >= dw - 4 && height >= dh - 4;
  if (coversFull) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function createWindow() {
  const settings = loadSettings();
  const saved = settings.windowBounds;

  mainWindow = new BrowserWindow({
    width:  saved?.width  ?? 540,
    height: saved?.height ?? 720,
    x:      saved?.x,
    y:      saved?.y,
    minWidth: 460,
    minHeight: 380,
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

  // Save position/size whenever the user moves or resizes the window.
  // Debounced — manual dragging emits "moved" continuously — and skipped
  // while collapsed so the bar's stub size never gets persisted.
  let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null;
      // Skip the collapsed stub and the docked strip — neither is a real
      // floating size, and persisting them would clobber the saved bounds.
      if (isCollapsed || isDocked()) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveSettings({ windowBounds: mainWindow.getBounds() });
      }
    }, 400);
  };
  mainWindow.on("moved", saveBounds);
  mainWindow.on("resized", saveBounds);

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    hideGlowOverlay();
    stopWindowDrag();
    uIOhook.stop();
    if (inputDebounceTimer) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await loadKeysFromEnv();

  // One-time migration: settings saved before the opaque-by-default change
  // get forced to a fully opaque window once; the Settings sliders remain
  // as the opt-out afterwards.
  if (!loadSettings().uiOpaqueMigration) {
    saveSettings({ opacity: 1, solidBackground: true, uiOpaqueMigration: true });
    console.log("[settings] applied one-time opaque-UI migration");
  }

  // One-time migration: the side-rail layout needs more horizontal room, so
  // widen any saved window that's narrower than the new minimum just once.
  if (!loadSettings().uiSideRailMigration) {
    const wb = loadSettings().windowBounds;
    saveSettings({
      windowBounds: wb ? { ...wb, width: Math.max(540, wb.width) } : null,
      uiSideRailMigration: true,
    });
    console.log("[settings] applied one-time side-rail width migration");
  }

  registerIpc();
  createWindow();

  // Dock transitions (including involuntary ones — docked monitor unplugged,
  // width changes) fan out to the renderer chrome and the glow overlay.
  let glowRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  setDockChangeListener(({ docked, rect, displayLost }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dock:changed", { docked, rect });
    }
    // Recreating the glow window is heavy — debounce so a live drag-resize
    // refreshes it once at the end, not per frame.
    if (glowRefreshTimer) clearTimeout(glowRefreshTimer);
    glowRefreshTimer = setTimeout(() => {
      glowRefreshTimer = null;
      void resolveWatchedDisplayId().then((id) => {
        if (glowWindow && !glowWindow.isDestroyed()) showGlowOverlay(id);
      });
    }, 300);
    if (displayLost && wantsDock) {
      // Redock once the display set settles and recalibration has re-resolved
      // the watched screen.
      if (redockTimer) clearTimeout(redockTimer);
      redockTimer = setTimeout(() => {
        redockTimer = null;
        if (wantsDock && !isDocked()) void dockToWatchedDisplay();
      }, 2_500);
    }
  });

  // Pixel-verified screen calibration: runs now (before the first capture)
  // and re-runs when monitors change; each fresh result re-places the glow on
  // the display that is ACTUALLY captured.
  initCalibration(() => {
    void resolveWatchedDisplayId().then((id) => {
      if (glowWindow && !glowWindow.isDestroyed()) showGlowOverlay(id);
    });
  });

  // The capture-region glow is always visible while the app is running so the
  // user can see exactly what's being captured at any time.
  void resolveWatchedDisplayId().then((id) => {
    showGlowOverlay(id);
    void setGlowAdjust(false); // safety: never stuck in interactive mode from a prior session
  });

  // Global input listener — debounced so rapid typing/clicking doesn't spam ticks
  function scheduleInputTick() {
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      mainWindow?.webContents.send("input:activity");
      inputDebounceTimer = null;
    }, 750);
  }
  uIOhook.on("click", scheduleInputTick);
  uIOhook.on("keyup", scheduleInputTick);
  // Safety net for manual dragging: if the renderer's pointerup is ever
  // missed, the global mouse-up still ends the drag.
  uIOhook.on("mouseup", stopWindowDrag);
  uIOhook.start();

  // System tray — always-available quit fallback regardless of which view is open.
  const trayIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip("SightLine");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show SightLine", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Quit SightLine", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => mainWindow?.show());

  // Ctrl+Q as a global keyboard shortcut to quit from anywhere.
  globalShortcut.register("Control+Q", () => app.quit());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Never leave reserved desktop space behind — release the appbar strip on
// the way out (dock.ts also handles window close; the OS handles a crash).
app.on("will-quit", () => {
  undockWindow();
});

function registerIpc() {
  ipcMain.handle("settings:get", () => loadSettings());

  ipcMain.handle(
    "settings:set",
    (_e: IpcMainInvokeEvent, patch: Record<string, unknown>) => {
      const prev = loadSettings();
      // Switching screens invalidates any saved capture region — the region
      // is in display-relative coordinates, so keeping it would silently crop
      // a nonsense rectangle out of the new screen.
      const screenChanged =
        ("selectedDisplayId" in patch &&
          patch.selectedDisplayId !== prev.selectedDisplayId) ||
        ("selectedSourceId" in patch &&
          patch.selectedSourceId !== prev.selectedSourceId);
      if (screenChanged && !("captureRegion" in patch)) {
        patch = { ...patch, captureRegion: null };
      }
      const next = saveSettings(patch);
      if (mainWindow && typeof patch.opacity === "number" && !isDocked()) {
        mainWindow.setOpacity(next.opacity);
      }
      // Moving the capture to a different screen (or recoloring the accent)
      // means the glow overlay has to be recreated.
      const accentChanged =
        "accentColor" in patch && next.accentColor !== prev.accentColor;
      if (screenChanged || accentChanged) {
        void resolveWatchedDisplayId().then(showGlowOverlay);
      } else if ("captureRegion" in patch) {
        // Region changed elsewhere (e.g. "Reset to full screen") — refresh the
        // glow so the visible box matches what's actually captured.
        broadcastGlowMode();
      }
      return next;
    },
  );

  ipcMain.handle("keys:get-status", async () => ({
    anthropic: await hasKey("anthropic"),
    openai: await hasKey("openai"),
    google: hasGoogleCredentials(),
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

  ipcMain.handle("capture:list-targets", () => listCaptureTargets());

  ipcMain.handle("capture:recalibrate", async () => {
    invalidateCalibration();
    let complete = false;
    try {
      const result = await getCalibration(true);
      complete = result.complete;
    } catch (err) {
      console.warn("[calibrate] manual recalibration failed:", err);
    }
    void resolveWatchedDisplayId().then((id) => {
      if (glowWindow && !glowWindow.isDestroyed()) showGlowOverlay(id);
    });
    return { complete };
  });

  ipcMain.handle(
    "capture:once",
    async (_e: IpcMainInvokeEvent, payload: { displayId: string | null }) => {
      const settings = loadSettings();
      return await captureFrame(
        {
          displayId: payload.displayId ?? null,
          sourceId: settings.selectedSourceId,
          sourceName: settings.selectedSourceName,
        },
        settings.captureRegion ?? null,
      );
    },
  );

  ipcMain.handle("files:pick-context", async (): Promise<UploadedContext[]> => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Attach context",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Text & Markdown", extensions: ["txt", "md", "markdown", "text"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    const MAX_BYTES = 200_000;
    const files: UploadedContext[] = [];
    for (const filePath of result.filePaths) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const text = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
        files.push({ name: path.basename(filePath), text });
      } catch (err) {
        console.error("[files] failed to read", filePath, err);
      }
    }
    return files;
  });

  ipcMain.handle(
    "claude:next-instruction",
    async (
      e: IpcMainInvokeEvent,
      args: {
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
        sessionJustStarted?: boolean;
      },
    ) => {
      try {
        return await getNextInstruction(args, (chunk) => {
          if (!e.sender.isDestroyed()) {
            e.sender.send("claude:speech-chunk", chunk);
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
    async (_e: IpcMainInvokeEvent, args: { mode: AppMode; goal: string }) => {
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
    "claude:get-session-plan",
    async (
      _e: IpcMainInvokeEvent,
      args: {
        mode: AppMode;
        goal: string;
        clarifications: Clarification[];
        screenshot?: string;
      },
    ) => {
      try {
        return await getSessionPlan(args);
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
      // Docked: a translucent appbar reads as broken chrome — stay opaque.
      const clamped = isDocked()
        ? 1
        : Math.max(0.25, Math.min(1, payload.opacity));
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
    "window:set-collapsed",
    (_e: IpcMainInvokeEvent, payload: { collapsed: boolean }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // Docked: collapse shrinks the reserved strip to a thin rail instead
      // of the floating capsule — the session keeps running, the desktop
      // gets its width back.
      if (isDocked()) {
        updateDockWidth(
          payload.collapsed
            ? RAIL_WIDTH
            : clampDockWidth(loadSettings().dockWidth),
        );
        return;
      }
      const b = mainWindow.getBounds();
      if (payload.collapsed && !isCollapsed) {
        expandedSize = { width: b.width, height: b.height };
        isCollapsed = true;
        // Must shrink the minimum before setBounds — the normal minHeight
        // (380) would block the bar height.
        mainWindow.setMinimumSize(300, 48);
        mainWindow.setBounds({ x: b.x, y: b.y, width: 380, height: 56 });
        mainWindow.setResizable(false);
      } else if (!payload.collapsed && isCollapsed) {
        isCollapsed = false;
        mainWindow.setResizable(true);
        mainWindow.setMinimumSize(320, 380);
        // Expand where the bar currently sits.
        mainWindow.setBounds({
          x: b.x,
          y: b.y,
          width: expandedSize?.width ?? 380,
          height: expandedSize?.height ?? 720,
        });
      }
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

  ipcMain.on("window:drag-start", () => startWindowDrag());
  ipcMain.on("window:drag-end", () => stopWindowDrag());

  ipcMain.handle("window:minimize", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // A minimized appbar would leave a dead reserved strip — undock first.
    if (isDocked()) {
      wantsDock = false;
      undockWindow();
    }
    mainWindow.minimize();
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
      // Fallback chain: Google Chirp 3 → OpenAI → error envelope. The
      // renderer only reaches the system voice when both cloud engines fail.
      // Each engine is wrapped in a hard timeout so a single wedged request
      // can't permanently silence TTS — a slow Google call falls through to
      // OpenAI, a slow OpenAI call surfaces an error the renderer can log.
      let googleErr = "";
      if (hasGoogleCredentials()) {
        try {
          const buffer = await withTimeout(
            speakTextGoogle(payload.text, payload.voice),
            10_000,
            "google_tts_timeout",
          );
          return { audioBase64: buffer.toString("base64"), engine: "google" as const };
        } catch (err) {
          googleErr = err instanceof Error ? err.message : String(err);
          console.warn("[SightLine TTS] Google TTS failed, trying OpenAI:", googleErr);
        }
      }
      try {
        const buffer = await withTimeout(
          speakText(payload.text, { voice: payload.voice }),
          15_000,
          "openai_tts_timeout",
        );
        return { audioBase64: buffer.toString("base64"), engine: "openai" as const };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!googleErr && msg.includes("missing_openai_key")) {
          return { __error: "missing_openai_key" } as const;
        }
        console.warn("[SightLine TTS] all engines failed:", googleErr, msg);
        return {
          __error: "request_failed",
          message: [googleErr, msg].filter(Boolean).join(" / "),
        } as const;
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

  ipcMain.handle(
    "overlay:set-adjust",
    (_e: IpcMainInvokeEvent, payload: { adjust: boolean }) =>
      setGlowAdjust(Boolean(payload.adjust)),
  );

  ipcMain.handle(
    "overlay:commit-region",
    async (
      _e: IpcMainInvokeEvent,
      payload: {
        region: { x: number; y: number; width: number; height: number } | null;
      },
    ) => {
      const region = normalizeRegion(
        payload.region,
        await resolveWatchedDisplayId(),
      );
      saveSettings({ captureRegion: region });
      await setGlowAdjust(false);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("overlay:region-updated", region);
      }
    },
  );

  ipcMain.handle("overlay:cancel-adjust", () => setGlowAdjust(false));

  ipcMain.on("session:log", (_e, message: string) => {
    console.log("[renderer]", message);
  });

  ipcMain.handle("dock:set", async (_e, payload: { docked: boolean }) => {
    wantsDock = Boolean(payload.docked);
    if (redockTimer) {
      clearTimeout(redockTimer);
      redockTimer = null;
    }
    if (wantsDock) {
      await dockToWatchedDisplay();
    } else {
      undockWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(loadSettings().opacity);
      }
    }
    return {
      docked: isDocked(),
      rect: getDockRectDip()?.rect ?? null,
      available: isDockingAvailable(),
    };
  });

  // Live drag-resize fires many times per second — apply the width
  // immediately (that's the live re-flow), persist it debounced.
  let dockWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
  ipcMain.handle("dock:resize", (_e, payload: { width: number }) => {
    const width = clampDockWidth(payload.width);
    if (isDocked()) updateDockWidth(width);
    if (dockWidthSaveTimer) clearTimeout(dockWidthSaveTimer);
    dockWidthSaveTimer = setTimeout(() => {
      dockWidthSaveTimer = null;
      saveSettings({ dockWidth: width });
    }, 400);
    return width;
  });

  ipcMain.handle("dock:state", () => ({
    docked: isDocked(),
    rect: getDockRectDip()?.rect ?? null,
  }));

  ipcMain.handle(
    "claude:evaluate-goal",
    async (
      _e: IpcMainInvokeEvent,
      payload: {
        mode: AppMode;
        goal: string;
        completedSteps: string[];
        conversation: ConversationTurn[];
        frames: CaptureFrame[];
      },
    ) => {
      try {
        return await getGoalEvaluation(payload);
      } catch (err) {
        if (err instanceof MissingApiKeyError) return { __error: "missing_api_key" };
        const msg = err instanceof Error ? err.message : String(err);
        return { __error: "request_failed", message: msg };
      }
    },
  );
}
