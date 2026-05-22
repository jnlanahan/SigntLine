import { desktopCapturer, screen } from "electron";
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

  // Match by display_id when available; fall back to first source.
  const match =
    sources.find((s) => s.display_id === String(target.id)) ?? sources[0];
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

function pickDisplay(selectedId: string | null) {
  const all = screen.getAllDisplays();
  if (selectedId) {
    const hit = all.find((d) => String(d.id) === selectedId);
    if (hit) return hit;
  }
  return screen.getPrimaryDisplay();
}
