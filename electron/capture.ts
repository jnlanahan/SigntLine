import { desktopCapturer, nativeImage, screen } from "electron";
import type { Display, DesktopCapturerSource } from "electron";
import {
  getCalibration,
  invalidateCalibration,
  type CalibrationResult,
} from "./calibrate";
import { getDockRectDip } from "./dock";
import { subtractDockStrip } from "./dock-geometry";
import type {
  CaptureFrame,
  CaptureRegion,
  CaptureTarget,
  DisplayInfo,
} from "./types";

// Calibration is best-effort: capture must keep working (via the ID-matching
// ladder) even when probing fails entirely.
async function getCalibrationSafe(): Promise<CalibrationResult | null> {
  try {
    return await getCalibration();
  } catch (err) {
    console.warn("[capture] calibration unavailable:", err);
    return null;
  }
}

// Largest dimension we keep for the final vision payload. Cropping happens at
// (near-)native resolution first, then we downscale to this for the API call.
const MAX_PAYLOAD_WIDTH = 1280;
// JPEG instead of PNG: 5-10x smaller payload for screenshots (the model sees
// pixels, not encodings), which directly cuts upload time on every tick.
// Quality stays >= 80 so small UI text remains legible.
const JPEG_QUALITY = 82;
// Cap the intermediate full-screen grab so 4K/5K displays don't blow up memory.
const MAX_GRAB_WIDTH = 2560;

export function listDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label && d.label.length > 0 ? d.label : `Display ${i + 1}`,
    primary: d.id === primary.id,
    width: d.size.width,
    height: d.size.height,
  }));
}

/**
 * List every screen capture source with a live thumbnail, paired to a display
 * when the platform lets us identify it. The user picks a target by looking
 * at the thumbnail — the only method that can't be fooled by Windows'
 * unreliable display-to-source ID mapping.
 */
export async function listCaptureTargets(): Promise<CaptureTarget[]> {
  const cal = await getCalibrationSafe();
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });

  return sources.map((s, i) => {
    // Calibrated (pixel-verified) pairing first; ID/index guesses only as
    // fallback when calibration couldn't identify this source.
    const calibratedDisplayId = cal?.sourceToDisplay.get(s.id);
    const display =
      (calibratedDisplayId
        ? displays.find((d) => String(d.id) === calibratedDisplayId)
        : undefined) ??
      displays.find((d) => String(d.id) === s.display_id) ??
      (sources.length === displays.length ? displays[i] : null);
    const displayIndex = display ? displays.indexOf(display) : i;
    const label =
      display?.label && display.label.length > 0
        ? display.label
        : s.name || `Display ${displayIndex + 1}`;
    const thumbSize = s.thumbnail.getSize();
    return {
      sourceId: s.id,
      sourceName: s.name,
      displayId: display ? String(display.id) : s.display_id || null,
      label,
      primary: display ? display.id === primary.id : i === 0,
      thumbnailDataUrl: `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString("base64")}`,
      width: display?.size.width ?? thumbSize.width,
      height: display?.size.height ?? thumbSize.height,
    };
  });
}

export interface CaptureSelection {
  displayId: string | null;
  // Source the user pinned by picking a thumbnail — wins over ID matching.
  sourceId?: string | null;
  sourceName?: string | null;
}

// Geometry of the most recent capture: which display it came from and the
// display-relative DIP rect the frame covers (after dock-strip subtraction
// and region cropping). Lets highlight coordinates expressed as fractions of
// the screenshot be mapped back onto the physical screen.
export interface CaptureGeometry {
  displayId: string;
  rect: CaptureRegion;
}

let lastCaptureGeometry: CaptureGeometry | null = null;

export function getLastCaptureGeometry(): CaptureGeometry | null {
  return lastCaptureGeometry;
}

// Resolve the display whose geometry drives grab sizing and region cropping.
// A pinned source's CALIBRATED display wins — it's the screen actually being
// captured — falling back to the stored displayId only when unknown.
function resolveTargetDisplay(
  selection: CaptureSelection,
  cal: CalibrationResult | null,
): Display {
  if (cal) {
    const calId =
      (selection.sourceId && cal.sourceToDisplay.get(selection.sourceId)) ||
      (selection.sourceName && cal.nameToDisplay.get(selection.sourceName)) ||
      null;
    if (calId) {
      const hit = screen.getAllDisplays().find((d) => String(d.id) === calId);
      if (hit) return hit;
    }
  }
  return pickDisplay(selection.displayId);
}

function findPinnedOrCalibrated(
  sources: DesktopCapturerSource[],
  selection: CaptureSelection,
  cal: CalibrationResult | null,
  target: Display,
): { source: DesktopCapturerSource; via: string } | null {
  const byId = selection.sourceId
    ? sources.find((s) => s.id === selection.sourceId)
    : undefined;
  if (byId) return { source: byId, via: "pinned-id" };
  const byName = selection.sourceName
    ? sources.find((s) => s.name === selection.sourceName)
    : undefined;
  if (byName) return { source: byName, via: "pinned-name" };
  const calSourceId = cal?.displayToSource.get(String(target.id));
  const byCal = calSourceId
    ? sources.find((s) => s.id === calSourceId)
    : undefined;
  if (byCal) return { source: byCal, via: "calibrated-source" };
  return null;
}

/**
 * Capture a single frame from the selected screen. Returned as a base64 JPEG
 * data URL — never written to disk. Caller owns disposal (drop the reference).
 */
export async function captureFrame(
  selection: CaptureSelection,
  region: CaptureRegion | null = null,
): Promise<CaptureFrame> {
  // Awaiting calibration here also guarantees no capture runs while marker
  // windows are on screen — magenta frames can never reach the model.
  let cal = await getCalibrationSafe();
  const target = resolveTargetDisplay(selection, cal);

  // Grab the full display at (near-)native resolution so a cropped sub-region
  // still has enough detail. We downscale the final crop afterwards.
  const nativeWidth = Math.round(target.size.width * target.scaleFactor);
  const grabWidth = Math.min(nativeWidth, MAX_GRAB_WIDTH);
  const grabHeight = Math.round(
    (grabWidth / target.size.width) * target.size.height,
  );

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: grabWidth, height: grabHeight },
    fetchWindowIcons: false,
  });

  // Resolution order: user-pinned source (picked by thumbnail) → calibrated
  // mapping → the old ID-matching ladder as last resort. If the pinned or
  // calibrated source vanished (monitor unplugged, source ids rotated),
  // recalibrate once and retry before falling back.
  let resolved = findPinnedOrCalibrated(sources, selection, cal, target);
  const expectedButMissing =
    !resolved &&
    (selection.sourceId || selection.sourceName || cal?.displayToSource.size);
  if (expectedButMissing) {
    invalidateCalibration();
    try {
      cal = await getCalibration(true);
    } catch {
      cal = null;
    }
    resolved = findPinnedOrCalibrated(sources, selection, cal, target);
  }

  let match: DesktopCapturerSource | undefined;
  if (resolved) {
    match = resolved.source;
    const logLine = `[capture] display=${target.id} matched via ${resolved.via} (source.name="${match.name}", sources=${sources.length})`;
    if (logLine !== lastMatchLog) {
      lastMatchLog = logLine;
      console.log(logLine);
    }
  } else {
    match = matchSource(sources, target);
  }
  if (!match) {
    throw new Error("No screen capture source available");
  }
  let image = match.thumbnail;
  if (image.isEmpty()) {
    throw new Error("Captured an empty frame (permission may be denied)");
  }

  // Coach Mode: while the sidebar is docked on this display, its own strip is
  // cut out of every frame — the model never sees its own panel. The dock
  // strip is subtracted FIRST; the user's region (drawn inside the glow
  // window, which itself covers only the remainder while docked) applies
  // relative to that base. Both are clamped.
  let effectiveRegion = region;
  const dock = getDockRectDip();
  if (dock && dock.displayId === String(target.id)) {
    const base = subtractDockStrip(target.bounds, dock.rect);
    const baseRel = {
      x: base.x - target.bounds.x,
      y: base.y - target.bounds.y,
      width: base.width,
      height: base.height,
    };
    if (region) {
      const x = baseRel.x + clamp(region.x, 0, Math.max(0, baseRel.width - 1));
      const y = baseRel.y + clamp(region.y, 0, Math.max(0, baseRel.height - 1));
      effectiveRegion = {
        x,
        y,
        width: clamp(region.width, 1, baseRel.x + baseRel.width - x),
        height: clamp(region.height, 1, baseRel.y + baseRel.height - y),
      };
    } else {
      effectiveRegion = baseRel;
    }
  }

  // Crop to the effective region. It's in display-relative DIP, so we scale
  // it into the captured thumbnail's pixel space.
  if (effectiveRegion) {
    const ts = image.getSize();
    const sx = ts.width / target.size.width;
    const sy = ts.height / target.size.height;
    const x = clamp(Math.round(effectiveRegion.x * sx), 0, Math.max(0, ts.width - 1));
    const y = clamp(Math.round(effectiveRegion.y * sy), 0, Math.max(0, ts.height - 1));
    const w = clamp(Math.round(effectiveRegion.width * sx), 1, ts.width - x);
    const h = clamp(Math.round(effectiveRegion.height * sy), 1, ts.height - y);
    if (w > 0 && h > 0) {
      image = image.crop({ x, y, width: w, height: h });
    }
  }

  // Downscale the (possibly cropped) image for the vision payload.
  const cropped = image.getSize();
  if (cropped.width > MAX_PAYLOAD_WIDTH) {
    image = image.resize({ width: MAX_PAYLOAD_WIDTH });
  }

  lastCaptureGeometry = {
    displayId: String(target.id),
    rect: effectiveRegion ?? {
      x: 0,
      y: 0,
      width: target.size.width,
      height: target.size.height,
    },
  };

  const size = image.getSize();
  return {
    dataUrl: `data:image/jpeg;base64,${image.toJPEG(JPEG_QUALITY).toString("base64")}`,
    timestamp: Date.now(),
    width: size.width,
    height: size.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Width used for historical frames in the vision payload. Only the latest
// frame has to be sharp enough to read a button label; older frames exist so
// the model can see what changed, and that survives heavy downscaling. At
// this width a frame costs ~300 tokens instead of ~1200.
const CONTEXT_FRAME_WIDTH = 640;
const CONTEXT_FRAME_QUALITY = 65;

/**
 * Re-encode an already-captured frame at context resolution. Returns the
 * original data URL unchanged if anything goes wrong — a bigger image is
 * always safe, a broken one is not.
 */
export function toContextResolution(dataUrl: string): string {
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return dataUrl;
    const { width } = image.getSize();
    if (width <= CONTEXT_FRAME_WIDTH) return dataUrl;
    const small = image.resize({ width: CONTEXT_FRAME_WIDTH });
    const jpeg = small.toJPEG(CONTEXT_FRAME_QUALITY);
    if (jpeg.length === 0) return dataUrl;
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return dataUrl;
  }
}

// On Windows, desktopCapturer's source.display_id often doesn't equal the
// screen module's display.id (different format, sometimes empty), so a plain
// display_id match silently captures the wrong monitor. Try a ladder of
// strategies and log which one matched so failures are never silent.
let lastMatchLog = "";

function matchSource(
  sources: DesktopCapturerSource[],
  target: Display,
): DesktopCapturerSource | undefined {
  let source: DesktopCapturerSource | undefined;
  let strategy = "";

  // 1. Exact display_id match — correct when the platform provides it.
  source = sources.find((s) => s.display_id === String(target.id));
  if (source) strategy = "display_id";

  // 2. Single source — trivially correct on single-monitor setups.
  if (!source && sources.length === 1) {
    source = sources[0];
    strategy = "single";
  }

  // 3. Index alignment: desktopCapturer screen sources are enumerated in the
  //    same order as screen.getAllDisplays() in practice (not contractual —
  //    hence gated on equal counts and ranked below display_id).
  if (!source) {
    const all = screen.getAllDisplays();
    const idx = all.findIndex((d) => d.id === target.id);
    if (idx >= 0 && idx < sources.length && sources.length === all.length) {
      source = sources[idx];
      strategy = "index";
    }
  }

  // 4. Aspect-ratio match: thumbnails preserve the source display's aspect,
  //    so the closest aspect wins — but only when it's a unique best match.
  if (!source) {
    const targetAspect = target.size.width / target.size.height;
    const ranked = sources
      .map((s) => {
        const ts = s.thumbnail.getSize();
        const aspect = ts.height > 0 ? ts.width / ts.height : 0;
        return { s, diff: Math.abs(aspect - targetAspect) };
      })
      .sort((a, b) => a.diff - b.diff);
    if (ranked.length > 1 && ranked[1].diff - ranked[0].diff > 0.01) {
      source = ranked[0].s;
      strategy = "aspect";
    }
  }

  // 5. Last resort — first source, loudly.
  if (!source) {
    source = sources[0];
    strategy = "first-source-fallback";
  }

  const logLine =
    `[capture] display=${target.id} matched via ${strategy} ` +
    `(source.display_id="${source?.display_id ?? ""}", ` +
    `source.name="${source?.name ?? ""}", sources=${sources.length})`;
  if (logLine !== lastMatchLog) {
    lastMatchLog = logLine;
    if (strategy === "first-source-fallback") {
      console.warn(logLine + " — could not identify the selected monitor!");
    } else {
      console.log(logLine);
    }
  }
  return source;
}

function pickDisplay(selectedId: string | null) {
  const all = screen.getAllDisplays();
  if (selectedId) {
    const hit = all.find((d) => String(d.id) === selectedId);
    if (hit) return hit;
  }
  return screen.getPrimaryDisplay();
}
