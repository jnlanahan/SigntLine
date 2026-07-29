// read_screen_region — the agent's zoom lens.
//
// Every frame the model normally sees is downscaled to 1280px wide so the
// per-tick payload stays affordable. That is fine for "which window is open"
// and quietly terrible for "what does this error dialog actually say" — small
// UI text is the first casualty of the downscale, and error text is exactly
// what the troubleshooting skill needs to read.
//
// This tool re-captures the watched screen cropped to a fraction of the last
// frame. Because the crop happens in capture.ts's near-native grab space
// BEFORE the downscale, a small region comes back at far higher effective
// resolution than the same pixels in the full frame.

import type { AgentTool } from "../harness/types";

function frac(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(1, v))
    : fallback;
}

export const readScreenRegionTool: AgentTool = {
  name: "read_screen_region",
  description:
    "Zoom in on part of the screen and look again at much higher resolution. Give the region as fractions of the latest screenshot (x/y = top-left corner, w/h = size, all 0-1). Use this when text matters and you cannot read it clearly: an error message or dialog, a small field label, a status line, a value in a table. Pad the region generously — a region roughly a quarter of the screen or smaller is where this helps most. Do not use it to re-examine something you can already read.",
  inputSchema: {
    type: "object",
    properties: {
      x: { type: "number", description: "Left edge, 0-1 fraction of the screenshot width." },
      y: { type: "number", description: "Top edge, 0-1 fraction of the screenshot height." },
      w: { type: "number", description: "Width, 0-1 fraction." },
      h: { type: "number", description: "Height, 0-1 fraction." },
      reason: {
        type: "string",
        description: "What you are trying to read, in a few words.",
      },
    },
    required: ["x", "y", "w", "h"],
  },
  async run(input, deps) {
    const x = frac(input.x, 0);
    const y = frac(input.y, 0);
    const rect = {
      x,
      y,
      w: Math.min(frac(input.w, 1), 1 - x),
      h: Math.min(frac(input.h, 1), 1 - y),
    };
    if (rect.w <= 0 || rect.h <= 0) {
      return { text: "That region is empty. Give a wider box.", isError: true };
    }

    const frame = await deps.captureRegion(rect);
    if (!frame) {
      return {
        text: "Could not re-capture that region. Work from the full screenshot you already have.",
        isError: true,
      };
    }
    return {
      text: `Zoomed view of the requested region (${frame.width}x${frame.height}):`,
      imageDataUrl: frame.dataUrl,
    };
  },
};
