// Pure pixel detection for screen calibration — no Electron imports, so the
// renderer test suite can unit-test it directly.
//
// Why this exists: on some Windows machines Electron's desktopCapturer
// source.display_id does NOT correspond to the same physical screen as
// screen.getAllDisplays() — the mapping is silently swapped, so any ID-based
// pairing captures the wrong monitor. Calibration establishes ground truth by
// showing a solid magenta marker window on one display at a time and finding
// which capture source actually contains it.

// The colour painted on screen during calibration. It lives here, beside the
// thresholds it must satisfy, so the two can never drift apart — and so the
// renderer test suite can check it without importing Electron.
//
// Pure #f0f reads as a graphics driver failure on a full screen, which is
// alarming; this is the softest magenta that still clears markerRatio().
export const MARKER_COLOR = "#c860c8";

export interface BitmapLike {
  // Raw pixel data, 4 bytes per pixel. Electron's nativeImage.toBitmap()
  // returns BGRA on Windows. Magenta is deliberately symmetric in R and B, so
  // a BGRA/RGBA channel-order mistake cannot produce a false negative.
  data: Uint8Array;
  width: number;
  height: number;
}

// Fraction of sampled pixels that read as "magenta-ish". Tolerant thresholds
// survive Night Light (blue reduction), HDR tone mapping, and thumbnail
// scaling artifacts.
export function markerRatio(bmp: BitmapLike): number {
  const { data, width, height } = bmp;
  const totalPixels = width * height;
  if (totalPixels === 0 || data.length < totalPixels * 4) return 0;

  let sampled = 0;
  let hits = 0;
  // Stride-2 sampling in both axes: 1/4 of pixels, plenty for a full-screen marker.
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const b = data[i];
      const g = data[i + 1];
      const r = data[i + 2];
      sampled++;
      if (r >= 120 && b >= 100 && g <= 110 && r - g >= 50 && b - g >= 40) {
        hits++;
      }
    }
  }
  return sampled === 0 ? 0 : hits / sampled;
}

export interface ProbeCandidate {
  id: string;
  ratio: number;
}

export interface ProbePick {
  id: string;
  ratio: number;
  runnerUpRatio: number;
  confident: boolean;
}

// The marker covers a whole display, so the winning source should be mostly
// magenta (~0.9) while every other source is near zero.
export const MIN_MARKER_RATIO = 0.35;

export function pickMarkerSource(
  candidates: ProbeCandidate[],
): ProbePick | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.ratio - a.ratio);
  const best = sorted[0];
  const runnerUpRatio = sorted.length > 1 ? sorted[1].ratio : 0;
  const confident =
    best.ratio >= MIN_MARKER_RATIO &&
    (runnerUpRatio < 0.05 || best.ratio >= 3 * runnerUpRatio);
  return { id: best.id, ratio: best.ratio, runnerUpRatio, confident };
}
