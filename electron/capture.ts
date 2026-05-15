import { desktopCapturer, screen } from "electron";
import type { CaptureFrame, DisplayInfo } from "./types";

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
): Promise<CaptureFrame> {
  const target = pickDisplay(selectedDisplayId);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      // Downscale to keep payload size reasonable for vision input.
      // Width 1280 covers most UI detail while staying under ~1.5 MB.
      width: Math.min(target.size.width, 1280),
      height: Math.min(
        target.size.height,
        Math.round((1280 / target.size.width) * target.size.height),
      ),
    },
    fetchWindowIcons: false,
  });

  // Match by display_id when available; fall back to first source.
  const match =
    sources.find((s) => s.display_id === String(target.id)) ?? sources[0];
  if (!match) {
    throw new Error("No screen capture source available");
  }
  const image = match.thumbnail;
  if (image.isEmpty()) {
    throw new Error("Captured an empty frame (permission may be denied)");
  }
  const size = image.getSize();
  return {
    dataUrl: image.toDataURL(),
    timestamp: Date.now(),
    width: size.width,
    height: size.height,
  };
}

function pickDisplay(selectedId: string | null) {
  const all = screen.getAllDisplays();
  if (selectedId) {
    const hit = all.find((d) => String(d.id) === selectedId);
    if (hit) return hit;
  }
  return screen.getPrimaryDisplay();
}
