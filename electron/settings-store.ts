import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Settings } from "./types";

const DEFAULTS: Settings = {
  captureIntervalSec: 5,
  opacity: 0.92,
  selectedDisplayId: null,
  hasSeenPrivacyNotice: false,
  ttsEnabled: false,
  ttsVoice: "nova",
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...next };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.error("[settings] failed to write:", err);
  }
  return merged;
}
