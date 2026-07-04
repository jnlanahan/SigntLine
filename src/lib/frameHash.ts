// Screen-change signature: mean luminance of each cell in a 16x16 grid,
// quantized to one byte per cell and hex-encoded (512 chars).
//
// Two signatures are compared cell by cell; a cell "changed" when its
// luminance moved by more than CELL_DELTA. This is far more sensitive than
// the old 64-bit average-hash (which only noticed a change when a cell
// crossed the global mean — clicking a tab or button usually flipped ZERO
// bits, so the session loop never saw the user's progress), while still
// ignoring cursor movement and blinking carets, which are much smaller than
// one cell.
const GRID = 16;
const SAMPLE = 64; // downsample target before binning (4x4 px per cell)

// Minimum per-cell luminance move (0-255) to count the cell as changed.
// Averaged over a cell, a text caret or cursor shifts luminance by ~1-3;
// real UI changes (a panel, dialog, new rows of content) shift it by far more.
const CELL_DELTA = 8;

// Cells that must change for the screen to count as "changed". 2 cells of
// 256 tolerates a moved cursor sitting on a cell boundary plus one blinking
// element; a click that opens or alters anything visible touches more.
const CHANGED_CELLS_THRESHOLD = 2;

export async function hashFrame(dataUrl: string): Promise<string> {
  if (!dataUrl) return "";
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(SAMPLE, SAMPLE);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;

        const cellSize = SAMPLE / GRID;
        const cells = new Float64Array(GRID * GRID);
        for (let y = 0; y < SAMPLE; y++) {
          for (let x = 0; x < SAMPLE; x++) {
            const i = (y * SAMPLE + x) * 4;
            // Rec. 709 luma
            const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            const cx = Math.min(GRID - 1, Math.floor(x / cellSize));
            const cy = Math.min(GRID - 1, Math.floor(y / cellSize));
            cells[cy * GRID + cx] += lum;
          }
        }
        const cellPixels = cellSize * cellSize;
        let out = "";
        for (let i = 0; i < cells.length; i++) {
          const v = Math.max(0, Math.min(255, Math.round(cells[i] / cellPixels)));
          out += v.toString(16).padStart(2, "0");
        }
        resolve(out);
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

/**
 * Number of grid cells whose luminance moved by more than CELL_DELTA.
 * Infinity when either signature is missing or they're incomparable
 * (different lengths — e.g. a signature from an older version).
 */
export function hashDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length || a.length % 2 !== 0) {
    return Number.POSITIVE_INFINITY;
  }
  let changed = 0;
  for (let i = 0; i < a.length; i += 2) {
    const va = parseInt(a.slice(i, i + 2), 16);
    const vb = parseInt(b.slice(i, i + 2), 16);
    if (Number.isNaN(va) || Number.isNaN(vb)) return Number.POSITIVE_INFINITY;
    if (Math.abs(va - vb) > CELL_DELTA) changed++;
  }
  return changed;
}

export function hashesAreSimilar(a: string, b: string): boolean {
  return hashDistance(a, b) <= CHANGED_CELLS_THRESHOLD;
}
