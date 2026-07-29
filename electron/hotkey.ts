// Hold-to-talk key mapping.
//
// The push-to-talk key is watched through the same global uiohook the session
// loop already uses, because it has to work while the user is focused on the
// app they're being coached through — SightLine almost never has focus.
//
// The mapping itself is pure so it can be unit-tested without the native hook.

import type { PushToTalkKey } from "./types";

// uiohook keycodes (verified against uiohook-napi's UiohookKey table).
const UIOHOOK_CTRL = 29;
const UIOHOOK_CTRL_RIGHT = 3613;
const UIOHOOK_ALT = 56;
const UIOHOOK_ALT_RIGHT = 3640;
const UIOHOOK_F8 = 66;
const UIOHOOK_F9 = 67;

/**
 * Keycodes that count as "the push-to-talk key is down" for a given setting.
 * Modifiers list both the left and right physical keys — a user who reaches
 * for right-Alt should not find a dead button.
 */
export function pushToTalkCodes(key: PushToTalkKey): number[] {
  switch (key) {
    case "ctrl":
      return [UIOHOOK_CTRL, UIOHOOK_CTRL_RIGHT];
    case "alt":
      return [UIOHOOK_ALT, UIOHOOK_ALT_RIGHT];
    case "f8":
      return [UIOHOOK_F8];
    case "f9":
      return [UIOHOOK_F9];
    case "none":
      return [];
  }
}

export function isPushToTalkCode(key: PushToTalkKey, keycode: number): boolean {
  return pushToTalkCodes(key).includes(keycode);
}

/** Human-readable label for the UI and tooltips. */
export function pushToTalkLabel(key: PushToTalkKey): string {
  switch (key) {
    case "ctrl":
      return "Ctrl";
    case "alt":
      return "Alt";
    case "f8":
      return "F8";
    case "f9":
      return "F9";
    case "none":
      return "off";
  }
}

/**
 * Edge detector for a held key.
 *
 * uiohook re-emits keydown on OS auto-repeat, so a naive handler would fire a
 * "start talking" event many times per second while the key is held. This
 * collapses the stream to one press edge and one release edge, and is the only
 * stateful part of push-to-talk — kept here, pure, so it can be tested.
 */
export class HoldDetector {
  private down = false;

  /** Returns "press" / "release" on a state change, or null when nothing changed. */
  keyDown(matches: boolean): "press" | null {
    if (!matches) return null;
    if (this.down) return null; // auto-repeat
    this.down = true;
    return "press";
  }

  keyUp(matches: boolean): "release" | null {
    if (!matches) return null;
    if (!this.down) return null;
    this.down = false;
    return "release";
  }

  isDown(): boolean {
    return this.down;
  }

  /**
   * Force the key back to "up". Used when the setting changes or the session
   * ends mid-hold, so a stuck flag can never leave the mic latched open.
   */
  reset(): void {
    this.down = false;
  }
}
