import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Settings } from "./types";
import { DEFAULT_ELEVEN_VOICE_ID } from "./tts/shared";

const DEFAULTS: Settings = {
  captureIntervalSec: 5,
  opacity: 1,
  selectedDisplayId: null,
  selectedSourceId: null,
  selectedSourceName: null,
  captureRegion: null,
  hasSeenPrivacyNotice: false,
  ttsEnabled: true,
  ttsVoice: "nova",
  ttsProvider: "auto",
  elevenVoiceId: DEFAULT_ELEVEN_VOICE_ID,
  ttsSpeed: 1.0,
  // F9, not a modifier: the user is typing in someone else's app while this
  // hook is live, so a PTT key that fires on Ctrl+C would be unusable.
  pushToTalkKey: "f9",
  bargeInEnabled: true,
  // Generous by design: the loop's own spacing rules are the real cost
  // control, and a cap that trips mid-task is worse than no cap. This exists
  // to catch a runaway, not to ration normal use.
  sessionBudgetUsd: 3.0,
  historyEnabled: true,
  memoryEnabled: true,
  accentColor: "lime",
  windowBounds: null,
  solidBackground: true,
  uiOpaqueMigration: false,
  uiSideRailMigration: false,
  dockEnabled: true,
  dockSide: "left",
  dockWidth: 400,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

// Voice ids that shipped as a default but turned out to be unusable on some
// plans, mapped to nothing — anyone still pointing at one gets moved to the
// current default. Without this, a user who ran an earlier build keeps the bad
// id in settings.json forever and sees an empty voice dropdown.
const RETIRED_VOICE_IDS = new Set([
  // Rachel — a Voice Library voice, which free plans cannot use via the API.
  "21m00Tcm4TlvDq8ikWAM",
  // Charlotte — same.
  "XB0fDUnXU5powFXDhCwa",
]);

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULTS, ...parsed };
    if (RETIRED_VOICE_IDS.has(merged.elevenVoiceId)) {
      merged.elevenVoiceId = DEFAULTS.elevenVoiceId;
    }
    return merged;
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
