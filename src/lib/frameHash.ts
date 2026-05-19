const HASH_SIZE = 16;

export async function hashFrame(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(""); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = new OffscreenCanvas(HASH_SIZE, HASH_SIZE);
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(""); return; }
        ctx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);
        const data = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data;
        let hex = "";
        for (let i = 0; i < data.length; i += 4) {
          // Use only R and G channels for a compact fingerprint
          hex += data[i].toString(16).padStart(2, "0");
          hex += data[i + 1].toString(16).padStart(2, "0");
        }
        resolve(hex);
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

export function hashesAreSimilar(a: string, b: string, threshold = 0.06): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff / a.length < threshold;
}
