import { desktopCapturer, screen } from "electron";
import type { Display, DesktopCapturerSource } from "electron";
import type { CaptureFrame, CaptureRegion, DisplayInfo } from "./types";

// Largest dimension we keep for the final vision payload. Cropping happens at
// (near-)native resolution first, then we downscale to this for the API call.
const MAX_PAYLOAD_WIDTH = 1280;
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
 * Capture a single frame from a given display. Returned as a base64 PNG data
 * URL — never written to disk. Caller owns disposal (drop the reference).
 */
export async function captureFrame(
  selectedDisplayId: string | null,
  region: CaptureRegion | null = null,
): Promise<CaptureFrame> {
  const target = pickDisplay(selectedDisplayId);

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

  const match = matchSource(sources, target);
  if (!match) {
    throw new Error("No screen capture source available");
  }
  let image = match.thumbnail;
  if (image.isEmpty()) {
    throw new Error("Captured an empty frame (permission may be denied)");
  }

  // Crop to the selected region. The region is in display-relative DIP, so we
  // scale it into the captured thumbnail's pixel space.
  if (region) {
    const ts = image.getSize();
    const sx = ts.width / target.size.width;
    const sy = ts.height / target.size.height;
    const x = clamp(Math.round(region.x * sx), 0, Math.max(0, ts.width - 1));
    const y = clamp(Math.round(region.y * sy), 0, Math.max(0, ts.height - 1));
    const w = clamp(Math.round(region.width * sx), 1, ts.width - x);
    const h = clamp(Math.round(region.height * sy), 1, ts.height - y);
    if (w > 0 && h > 0) {
      image = image.crop({ x, y, width: w, height: h });
    }
  }

  // Downscale the (possibly cropped) image for the vision payload.
  const cropped = image.getSize();
  if (cropped.width > MAX_PAYLOAD_WIDTH) {
    image = image.resize({ width: MAX_PAYLOAD_WIDTH });
  }

  const size = image.getSize();
  return {
    dataUrl: image.toDataURL(),
    timestamp: Date.now(),
    width: size.width,
    height: size.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
