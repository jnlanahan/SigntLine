// Screen calibration: establishes the TRUE mapping between desktopCapturer
// sources and physical displays by showing a magenta marker window on one
// display at a time and detecting which capture source contains it.
//
// This exists because on some Windows machines source.display_id claims an
// exact match with screen.getAllDisplays() while actually referring to a
// DIFFERENT physical monitor — so capture silently watches the wrong screen.
// Pixels don't lie; IDs do.

import { BrowserWindow, desktopCapturer, screen } from "electron";
import { markerRatio, pickMarkerSource } from "./calibrate-detect";

export interface CalibrationResult {
  // desktopCapturer source.id -> String(display.id)
  sourceToDisplay: ReadonlyMap<string, string>;
  // String(display.id) -> source.id
  displayToSource: ReadonlyMap<string, string>;
  // source.name ("Screen 1") -> display id — source names are stable within a
  // boot, so pinned names survive app restarts.
  nameToDisplay: ReadonlyMap<string, string>;
  // Every display got a confident match.
  complete: boolean;
  calibratedAt: number;
}

const THUMB_SIZE = { width: 320, height: 200 };
const MARKER_PAINT_DELAY_MS = 300; // compositor needs a frame or two after show
const RETRY_DELAY_MS = 400;

const MARKER_HTML =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    "<!DOCTYPE html><html><body style='margin:0;background:#f0f'></body></html>",
  );

let cached: CalibrationResult | null = null;
let inFlight: Promise<CalibrationResult> | null = null;
let onChangeCb: ((r: CalibrationResult) => void) | null = null;
let firstProbeLogged = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scoreSourcesForMarker(): Promise<
  { id: string; name: string; ratio: number }[]
> {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: THUMB_SIZE,
    fetchWindowIcons: false,
  });
  return sources.map((s) => {
    const size = s.thumbnail.getSize();
    const bmp = {
      data: new Uint8Array(s.thumbnail.toBitmap()),
      width: size.width,
      height: size.height,
    };
    if (!firstProbeLogged && size.width > 0) {
      firstProbeLogged = true;
      const d = bmp.data;
      console.log(
        `[calibrate] pixel-order check (expect BGRA, magenta = high,low,high): [${d[0]},${d[1]},${d[2]},${d[3]}]`,
      );
    }
    return { id: s.id, name: s.name, ratio: markerRatio(bmp) };
  });
}

async function probeDisplay(
  display: Electron.Display,
): Promise<{ sourceId: string; sourceName: string } | null> {
  let marker: BrowserWindow | null = null;
  try {
    marker = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      show: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      webPreferences: { sandbox: true },
    });
    // NEVER setContentProtection(true) here — that would exclude the marker
    // from capture and break the whole probe.
    marker.setAlwaysOnTop(true, "screen-saver");
    marker.setIgnoreMouseEvents(true);
    marker.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    await marker.loadURL(MARKER_HTML);
    marker.showInactive();
    // Make sure the window really covers the intended display (loadURL/show
    // can shuffle bounds on mixed-DPI setups).
    marker.setBounds(display.bounds);
    await sleep(MARKER_PAINT_DELAY_MS);

    let scored = await scoreSourcesForMarker();
    let pick = pickMarkerSource(scored);
    if (!pick || !pick.confident) {
      await sleep(RETRY_DELAY_MS);
      scored = await scoreSourcesForMarker();
      pick = pickMarkerSource(scored);
    }

    if (pick && pick.confident) {
      const winner = scored.find((s) => s.id === pick.id);
      console.log(
        `[calibrate] display=${display.id} (${display.label || "unnamed"}) -> ${pick.id} "${winner?.name ?? ""}" ratio=${pick.ratio.toFixed(2)} runnerUp=${pick.runnerUpRatio.toFixed(2)}`,
      );
      return { sourceId: pick.id, sourceName: winner?.name ?? "" };
    }
    console.warn(
      `[calibrate] NO confident source for display=${display.id} (${display.label || "unnamed"}) — best ratio=${pick?.ratio.toFixed(2) ?? "n/a"} runnerUp=${pick?.runnerUpRatio.toFixed(2) ?? "n/a"}. Falling back to ID matching for this display.`,
    );
    return null;
  } catch (err) {
    console.warn(`[calibrate] probe failed for display=${display.id}:`, err);
    return null;
  } finally {
    if (marker && !marker.isDestroyed()) marker.close();
  }
}

async function calibrateCaptureMapping(): Promise<CalibrationResult> {
  const displays = screen.getAllDisplays();
  const sourceToDisplay = new Map<string, string>();
  const displayToSource = new Map<string, string>();
  const nameToDisplay = new Map<string, string>();

  // Single display + single source: trivially correct, no flash.
  if (displays.length === 1) {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false,
    });
    if (sources.length === 1) {
      const id = String(displays[0].id);
      sourceToDisplay.set(sources[0].id, id);
      displayToSource.set(id, sources[0].id);
      nameToDisplay.set(sources[0].name, id);
      return {
        sourceToDisplay,
        displayToSource,
        nameToDisplay,
        complete: true,
        calibratedAt: Date.now(),
      };
    }
  }

  let confident = 0;
  // Sequential: never two markers on screen at once.
  for (const display of displays) {
    const hit = await probeDisplay(display);
    if (hit) {
      const id = String(display.id);
      sourceToDisplay.set(hit.sourceId, id);
      displayToSource.set(id, hit.sourceId);
      if (hit.sourceName) nameToDisplay.set(hit.sourceName, id);
      confident++;
    }
  }

  return {
    sourceToDisplay,
    displayToSource,
    nameToDisplay,
    complete: confident === displays.length,
    calibratedAt: Date.now(),
  };
}

export function invalidateCalibration(): void {
  cached = null;
}

export async function getCalibration(force = false): Promise<CalibrationResult> {
  if (!force && cached) return cached;
  if (!force && inFlight) return inFlight;
  // Chain behind any in-flight run (serialized — markers never overlap), and
  // never let a previous rejection poison this run.
  const previous = (inFlight ?? Promise.resolve()).catch(() => undefined);
  const run = previous.then(async () => {
    if (!force && cached) return cached;
    const result = await calibrateCaptureMapping();
    cached = result;
    onChangeCb?.(result);
    return result;
  });
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

// Kick off the first calibration and keep the mapping fresh across monitor
// plug/unplug/DPI changes. onChange fires with each new result so main.ts can
// re-place the glow overlay on the (possibly re-identified) watched screen.
export function initCalibration(onChange?: (r: CalibrationResult) => void): void {
  onChangeCb = onChange ?? null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const recalibrate = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      invalidateCalibration();
      void getCalibration(true).catch((err) =>
        console.warn("[calibrate] recalibration failed:", err),
      );
    }, 1_000);
  };
  screen.on("display-added", recalibrate);
  screen.on("display-removed", recalibrate);
  screen.on("display-metrics-changed", recalibrate);
  void getCalibration().catch((err) =>
    console.warn("[calibrate] initial calibration failed:", err),
  );
}
