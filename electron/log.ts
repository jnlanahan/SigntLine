import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

// Persistent diagnostic log. Every loop decision, Claude action, and TTS
// event lands here (plus the console), so "why did it go quiet?" can be
// answered from the file instead of a live debugger.
//
// Location: %APPDATA%/SightLine/logs/sightline.log

const MAX_LOG_BYTES = 5_000_000; // rotate to .old past ~5 MB

let logDir: string | null = null;
let logFile: string | null = null;

function ensureLogFile(): string | null {
  if (logFile) return logFile;
  try {
    logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, "sightline.log");
    try {
      const { size } = fs.statSync(logFile);
      if (size > MAX_LOG_BYTES) {
        fs.renameSync(logFile, path.join(logDir, "sightline.old.log"));
      }
    } catch {
      // no existing file — fine
    }
    return logFile;
  } catch (err) {
    console.warn("[log] could not create log file:", err);
    logFile = null;
    return null;
  }
}

export function getLogPath(): string | null {
  return ensureLogFile();
}

/** Append one timestamped line to the log file and mirror it to the console. */
export function logLine(message: string): void {
  const stamp = new Date().toISOString();
  const line = `${stamp} ${message}`;
  console.log(line);
  const file = ensureLogFile();
  if (!file) return;
  try {
    fs.appendFileSync(file, line + "\n");
  } catch {
    // Logging must never break the app.
  }
}
