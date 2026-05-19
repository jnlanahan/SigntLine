// Perceptual hash: average luminance over an 8x8 grid, then compare each cell
// to the overall mean. The resulting 64-bit fingerprint is robust to mouse
// cursor movement, blinking carets, and small clock-style timer changes.
const GRID = 8;
const SAMPLE = 32; // downsample target before binning

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
        let mean = 0;
        for (let i = 0; i < cells.length; i++) {
          cells[i] /= cellPixels;
          mean += cells[i];
        }
        mean /= cells.length;

        // Hex bitstring, one bit per cell.
        let bits = 0n;
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] >= mean) bits |= 1n << BigInt(i);
        }
        resolve(bits.toString(16).padStart(16, "0"));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

// Hamming distance between two perceptual hashes.
function hammingDistance(a: string, b: string): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  try {
    const xa = BigInt("0x" + a);
    const xb = BigInt("0x" + b);
    let v = xa ^ xb;
    let count = 0;
    while (v !== 0n) {
      count++;
      v &= v - 1n;
    }
    return count;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// A 64-bit perceptual hash; distances under ~8 typically mean "visually the
// same screen with minor noise" (cursor, caret, small text changes).
const SIMILARITY_THRESHOLD = 8;

export function hashesAreSimilar(a: string, b: string): boolean {
  return hammingDistance(a, b) <= SIMILARITY_THRESHOLD;
}
