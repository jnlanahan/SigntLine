// On-disk audio cache for repeated speech.
//
// The coach says a fixed set of phrases constantly — thinking fillers, wrap-
// ups, reassurances. Synthesizing those every time costs ~250 ms of dead air
// on exactly the turns where responsiveness matters most (right after the user
// asks a question). Cached, they play in ~0 ms.
//
// Location: %APPDATA%/SightLine/tts-cache/<key>.mp3

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { cacheKeyFor, type SynthRequest } from "./shared";

// Generous but bounded: ~1500 short utterances at 64 kbps. Pruned oldest-first
// so a long-running install never grows without limit.
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
const PRUNE_TARGET_BYTES = 30 * 1024 * 1024;

let cacheDir: string | null = null;

function ensureDir(): string | null {
  if (cacheDir) return cacheDir;
  try {
    const dir = path.join(app.getPath("userData"), "tts-cache");
    fs.mkdirSync(dir, { recursive: true });
    cacheDir = dir;
    return dir;
  } catch {
    return null;
  }
}

function filePathFor(req: SynthRequest): string | null {
  const dir = ensureDir();
  if (!dir) return null;
  return path.join(dir, `${cacheKeyFor(req)}.mp3`);
}

export function readCached(req: SynthRequest): Buffer | null {
  const file = filePathFor(req);
  if (!file) return null;
  try {
    const buf = fs.readFileSync(file);
    if (buf.length === 0) return null;
    // Touch so pruning keeps what's actually being used.
    const now = new Date();
    try {
      fs.utimesSync(file, now, now);
    } catch {
      // best effort
    }
    return buf;
  } catch {
    return null;
  }
}

export function writeCached(req: SynthRequest, audio: Buffer): void {
  const file = filePathFor(req);
  if (!file || audio.length === 0) return;
  try {
    // Write-then-rename so a crash mid-write can't leave a truncated MP3 that
    // would be served forever as valid cache.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, audio);
    fs.renameSync(tmp, file);
  } catch {
    // Cache failures are never fatal.
  }
  maybePrune();
}

let pruneScheduled = false;

function maybePrune(): void {
  if (pruneScheduled) return;
  pruneScheduled = true;
  // Defer: pruning is a directory stat walk, and it must never sit in front of
  // audio playback.
  setTimeout(() => {
    pruneScheduled = false;
    pruneCache();
  }, 30_000).unref?.();
}

export function pruneCache(): void {
  const dir = ensureDir();
  if (!dir) return;
  try {
    const entries = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".mp3"))
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { full, size: st.size, mtime: st.mtimeMs };
      });
    const total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= MAX_CACHE_BYTES) return;
    entries.sort((a, b) => a.mtime - b.mtime); // oldest first
    let remaining = total;
    for (const e of entries) {
      if (remaining <= PRUNE_TARGET_BYTES) break;
      try {
        fs.unlinkSync(e.full);
        remaining -= e.size;
      } catch {
        // skip
      }
    }
  } catch {
    // best effort
  }
}
