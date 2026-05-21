# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite (port 5173) + Electron, hot-reloads React side
npm run build     # Production Vite build + esbuild for Electron main/preload
npm run dist      # Full Windows NSIS installer → release/
npm run lint      # tsc --noEmit on both tsconfig.json (src/) and tsconfig.node.json (electron/)
```

No test suite exists. Verification is manual — run the app and observe behavior.

## Architecture: two processes, one IPC bridge

The app has a hard split between two TypeScript compilation targets:

**Electron main process** (`electron/`, compiled by esbuild → `dist-electron/`)
- `main.ts` — creates windows, registers all IPC handlers in `registerIpc()`, manages `glowWindow` and global input hook (`uiohook-napi`)
- `claude.ts` — all Anthropic API calls; streams responses and fires `onInstructionReady` callback mid-stream for early TTS
- `capture.ts` — screenshot via Electron's `desktopCapturer`
- `credentials.ts` — API keys stored in Windows Credential Manager via `keytar`
- `settings-store.ts` — settings persisted to `%APPDATA%/SightLine/settings.json`
- `types.ts` — **shared type definitions** used by both processes

**React renderer** (`src/`, compiled by Vite → `dist/`)
- `store/session.ts` — Zustand store for all session state; `reset()` spreads `...initial` so any new field added to `initial` is automatically reset
- `store/settings.ts` — Zustand store that wraps IPC calls to load/patch settings
- `hooks/useSessionLoop.ts` — the main session loop: capture → hash check → Claude → TTS → reschedule
- `hooks/useTts.ts` — module-level audio state (`currentAudio`, `speakGeneration`); `speak()` unconditionally cancels in-progress audio before starting new audio

**The bridge** (`electron/preload.ts`)
- Exposes `window.sightline` via `contextBridge`
- `src/lib/api.ts` just re-exports the `SightLineApi` type and returns `window.sightline` — no logic lives there
- Adding a new IPC channel requires: handler in `registerIpc()`, method in `SightLineApi` interface, implementation in the `api` object (all in `preload.ts`)
- Channel naming: `namespace:action` (e.g. `overlay:show-glow`, `claude:next-instruction`)

## Session loop (`useSessionLoop.ts`)

The loop is a self-rescheduling `setTimeout` chain (not `setInterval`) with three polling tiers:
- **Alert** (2 s) — active for 20 s after any instruction; tracked via `afterInstructionAlertUntil` in session store
- **Normal** — `captureIntervalSec` from settings (default 15 s)
- **Idle** (30 s) — after 3 consecutive ticks with no screen change

The loop also has an input-triggered path (`uiohook-napi` global mouse/keyboard hook, 750 ms debounce) that fires an immediate tick — but **only outside the alert window**, because `speak()` cancels in-progress TTS and rapid input during alert mode causes constant interruptions.

Each tick is guarded by `inFlightRef` (no concurrent calls), `cooldownUntil` (2 s post-instruction), and `rateLimitUntil` (API backoff). External callers that invoke `tickRef.current()` directly inherit all these guards.

## Claude integration

`electron/claude.ts` streams the response and uses a regex to extract the `"instruction"` field mid-stream, firing `onInstructionReady` before the full JSON arrives — this lets TTS start speaking before the response finishes. The system prompt lives entirely in `SYSTEM_PROMPT` at the top of `claude.ts`; the JSON schema Claude must follow is documented inline there.

Screenshots are never written to disk. The session keeps a rolling buffer of the last 5 frames in memory (`store/session.ts → pushFrame`).

## API keys

Keys are read at startup from `.env` in the project root (or `%APPDATA%/SightLine/.env`) and stored in Windows Credential Manager. The `.env` file format: `ANTHROPIC_API_KEY=...` and `OPENAI_API_KEY=...` (optional — only needed for TTS/Whisper). Google Cloud TTS uses `GOOGLE_PROJECT_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`.
