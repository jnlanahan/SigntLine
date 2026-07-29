# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite (port 5173) + Electron, hot-reloads React side
npm run build     # Production Vite build + esbuild for Electron main/preload
npm run dist      # Full Windows NSIS installer → release/
npm run lint      # tsc --noEmit on both tsconfig.json (src/) and tsconfig.node.json (electron/)
```

```bash
npm test          # vitest — unit tests for the speech chunker, TTS helpers, timing guards
```

Runtime behavior (audio, capture, pacing feel) still needs a manual run to verify.

## Architecture: two processes, one IPC bridge

The app has a hard split between two TypeScript compilation targets:

**Electron main process** (`electron/`, compiled by esbuild → `dist-electron/`)
- `main.ts` — creates windows, registers all IPC handlers in `registerIpc()`, manages `glowWindow` and global input hook (`uiohook-napi`)
- `calibrate.ts` + `calibrate-detect.ts` — **screen calibration**: on some Windows machines `desktopCapturer.source.display_id` silently refers to the WRONG monitor (exact-looking ID match, wrong pixels). At startup (and on display changes / `capture:recalibrate`) a magenta marker window is flashed on each display and the capture source containing it is detected by pixel ratio (`calibrate-detect.ts` is pure and unit-tested). Everything that pairs sources↔displays (capture, the glow overlay via `resolveWatchedDisplayId()`, the screen picker) trusts this map first, IDs only as fallback. `captureFrame` awaits calibration, so markers never leak into captured frames. **Never trust display_id/ID matching for new features — go through the calibration map.**
- `claude.ts` — all Anthropic API calls; streams responses and emits sentence-level speech chunks mid-stream (via `speech-chunker.ts`) for early TTS
- `speech-chunker.ts` — pure module (no imports); incrementally extracts the `"instruction"` JSON string from the stream and splits it into sentences, holding back abbreviations/domains; unit-tested from `src/__tests__/speechChunker.test.ts`
- `dock.ts` + `dock-geometry.ts` — **Coach Mode docking**: during sessions the panel becomes a docked sidebar that reserves a strip of the watched monitor via the Windows AppBar API (`SHAppBarMessage` through `koffi` FFI) — the OS work area shrinks so maximized/snapped windows resize beside the coach. `dock-geometry.ts` is pure (unit-tested from `src/__tests__/dockGeometry.test.ts`); defaults are locked by `src/__tests__/dockSettings.test.ts`. Invariants: **never leave reserved space behind** (`ABM_REMOVE` fires on undock, window close, and `will-quit`; the OS reclaims it on crash), and **if koffi fails to load the app must fall back to floating** — docking can never make the app unusable. AppBar rects are physical pixels; convert only via `screen.dipToScreenRect`/`screenToDipRect`. `koffi`'s native binaries are `asarUnpack`ed in `package.json`.
- `capture.ts` — screenshot via Electron's `desktopCapturer`. **Capture exclusion rule:** while docked on the watched display, the sidebar's own strip is subtracted from every frame (dock strip first, then the user's `captureRegion` relative to the remainder) — the model never sees its own panel, and the glow overlay outlines only the remaining desktop
- `credentials.ts` — API keys stored in Windows Credential Manager via `keytar`
- `settings-store.ts` — settings persisted to `%APPDATA%/SightLine/settings.json`
- `types.ts` — **shared type definitions** used by both processes
- `tts/` — **the speech pipeline**. `tts/index.ts` is the only entry point: it owns the provider chain (ElevenLabs Flash → Google Chirp 3 → OpenAI → the renderer's system voice), per-provider timeouts, and the disk cache. **Invariant: it never throws for a recoverable reason** — a missing key, dead voice, or hung request must degrade the voice, never stop the session. `tts/shared.ts` is pure (cache keys, the fixed phrase set, `preprocessForTts`) and is imported by BOTH processes — that shared `preprocessForTts` is load-bearing: the startup cache warmer and the live session must produce byte-identical strings or every cache key misses. `warmPhraseCache()` pre-synthesizes the fixed phrases at launch, so a thinking filler plays in ~0 ms.
- `usage.ts` — pure token accounting and cost estimation. Pricing table, cache-read/write multipliers, and `budgetStatus()`. The loop checks the budget **before** each call, so the cap is actually a cap.
- `db/schema.ts` — the data model, **types and Postgres DDL in one file** so they can't drift. `db/store.ts` implements it over JSON files under `%APPDATA%/SightLine/data`; swapping it for Neon means writing a module with the same function signatures (see `docs/PRODUCTION.md`).
- `memory-rank.ts` — pure ranking for cross-session memory. Decides which remembered facts are worth the tokens. `MIN_SCORE` is calibrated against the score scale — set it too high and genuinely relevant memory gets silently dropped, which reads to the user as the coach having forgotten everything.
- `hotkey.ts` — pure push-to-talk key mapping plus `HoldDetector`, which collapses OS auto-repeat into single press/release edges.
- `agents/` — **one module per mode**: `tech-support.ts`, `training.ts`, `teacher.ts`, over shared voice/field rules in `shared.ts`.

**React renderer** (`src/`, compiled by Vite → `dist/`)
- `store/session.ts` — Zustand store for all session state; `reset()` spreads `...initial` so any new field added to `initial` is automatically reset
- `store/settings.ts` — Zustand store that wraps IPC calls to load/patch settings
- `hooks/useSessionLoop.ts` — the main session loop: capture → hash check → Claude → TTS → reschedule
- `hooks/useTts.ts` — module-level audio state (`currentAudio`, `speakGeneration`). Core primitive is `openSpeechStream()`: a per-response queue where sentences are enqueued as they stream in, cloud synthesis of chunk N+1 starts while chunk N plays, and playback is strictly ordered. Opening a new stream cancels the previous one; chunks within a stream are never cancelled mid-word. `speak(text)` is a one-shot stream (enqueue + end).

**The bridge** (`electron/preload.ts`)
- Exposes `window.sightline` via `contextBridge`
- `src/lib/api.ts` just re-exports the `SightLineApi` type and returns `window.sightline` — no logic lives there
- Adding a new IPC channel requires: handler in `registerIpc()`, method in `SightLineApi` interface, implementation in the `api` object (all in `preload.ts`)
- Channel naming: `namespace:action` (e.g. `overlay:show-glow`, `claude:next-instruction`)

## Session loop (`useSessionLoop.ts`)

The loop is a self-rescheduling `setTimeout` chain (not `setInterval`). Claude is called often and decides each tick whether to speak (`instruct`/`acknowledge`/`check_in`/`done`) or stay silent (`wait`). **Looking more often is not the same as talking more often** — `wait` is the model's most common action by design, and speech is gated separately — which is why the pacing below can be aggressive without the coach becoming interrupt-y. Triggers and guards (tech_support mode):
- **Backstop poll** — 15 s normally, 30 s once the screen has been still > 2 min
- **Input trigger** — `uiohook-napi` global mouse/keyboard hook (750 ms debounce in main) → tick after 1.5 s of input silence (`useQuietPeriod`), skipped while TTS is playing or the user is on the mic. This is the dominant term in "why did it take so long to react after I clicked something"
- **Follow-up trigger** — submitting a follow-up fires a tick immediately in every mode and bypasses call spacing; a spoken thinking filler ("Let me take a look.") plays while Claude looks, with the answer queued behind it. Fillers are pre-cached on disk, so they start in ~0 ms
- **Guards** — `inFlightRef` (no concurrent calls), 3 s minimum spacing between Claude calls (`TS_MIN_CALL_SPACING_MS`), `rateLimitUntil` (API backoff), the session budget (`electron/usage.ts`, checked before the call), and `listening`/`transcribing` (never tick while the user is speaking). External callers invoking `tickRef.current()` inherit all of these
- **Stall ladder** — when the screen has been still longer than the current step should take (`expected_pace`-scaled), a tick proceeds without a screen change so Claude can check in (at most once per minute). A `diverted` (digression) state only suppresses this for `DIVERTED_STALL_MS` (2 min) — a false digression call must never silence the app forever
- **Guaranteed first step** — the first tick after session start passes `sessionJustStarted`; the prompt forbids `wait` and `digression` on that turn, so the coach always speaks step 1 right after the plan overview

Timing constants are locked by regression tests in `src/__tests__/sessionLoop.timing.test.ts` — changing one means updating the test deliberately.

**Diagnostics:** every tick decision (skip reason, screen-change distance, Claude action + latency, TTS events) is appended to `%APPDATA%/sightline/logs/sightline.log` via `electron/log.ts`; renderer logs route through the `session:log` IPC. "Why did it go quiet?" is answered by grepping `[loop]` lines there — do not remove these logs. Screen-change detection lives in `src/lib/frameHash.ts` (16×16 luminance-cell signature; "changed" = >2 cells moving >8 luma) and the tick gate in `src/lib/loopGate.ts` — both unit-tested. Keep them sensitive: the historical failure mode was the app going silent because small UI changes (clicked tabs/buttons) hashed as "same screen".

## Claude integration

`electron/claude.ts` streams the response; `speech-chunker.ts` extracts the `"instruction"` field incrementally and each completed **sentence** is sent to the renderer (`claude:speech-chunk`) while the response is still generating — TTS starts on the first sentence, and later sentences synthesize while earlier ones play. Chunks are gated on the `"action"` key (emitted first in every mode's schema) so a `wait` never speaks. **Every mode must emit `action`** — a mode without it has no way to express "say nothing", so its silent turns parsed as `instruct` with an empty instruction and fell through to reading the raw JSON aloud. `src/__tests__/agentPrompts.test.ts` locks this for all three modes.

Agent prompts: **one module per mode** under `electron/agents/` — `tech-support.ts` (guide/pace, verify via the `expected_result` round-trip, troubleshoot + escalate-to-research, replan by rewriting `upcoming_steps`, point via `highlight`, remember across sessions), `training.ts` (silent observation; `wait` is the default action), and `teacher.ts` (Socratic, conversation-driven). Shared voice/field rules are in `agents/shared.ts`. Skill phrases are locked by `techSupportSkills.test.ts`, `claude.prompt.test.ts`, and `agentPrompts.test.ts`. Mid-session research (`research:search` in main.ts) uses Claude's `web_search` server tool via `runWebResearch()` with a DuckDuckGo instant-answer fallback. The system prompt is byte-identical across ticks and marked with `cache_control` — **never put timestamps or per-tick data in it** (that belongs in the user message via `buildContextHeader`); the cache hit rate is logged every tick, and a collapse toward zero means something leaked into the prefix.

Screenshots are JPEG (quality 82, max 1280 px wide — `capture.ts`), never written to disk. The session keeps a rolling buffer of the last 5 frames in memory (`store/session.ts → pushFrame`); `claude.ts` sends the last 2 (`MAX_FRAMES`) — and only 1 when the screen hasn't changed, since the history frame would be a duplicate. Only the latest frame goes at full resolution; earlier frames are re-encoded at 640 px by `toContextResolution()` (~4x cheaper) because their only job is to show what changed. Cost per tick is locked by `src/__tests__/usage.test.ts`, which fails if the payload inflates.

**Cross-session memory:** the agent's `remember` output field records durable facts (setup, preferences, past obstacles); `memory-rank.ts` selects which to recall against the new goal, and the result is resolved **once at session start** so the prompt prefix stays byte-stable across ticks. `notes` remains the within-session scratchpad — the two are deliberately separate.

## API keys

Keys are read at startup from `.env` in the project root (or `%APPDATA%/SightLine/.env`) and stored in Windows Credential Manager. See `.env.example` for the full list. `ANTHROPIC_API_KEY` is the only one that's required; `ELEVENLABS_API_KEY` is the highest-value optional one (the human-sounding, low-latency voice), `OPENAI_API_KEY` powers hold-to-talk transcription plus a TTS fallback, and Google Cloud TTS uses `GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`. Missing voice keys degrade the voice, never break the session.

## Persistence

Sessions, memory, and saved plans persist to JSON under `%APPDATA%/SightLine/data` via `electron/db/store.ts`. Screenshots are **never** persisted — they live in memory for the length of a session only, and that's a privacy property worth keeping. `electron/db/schema.ts` holds the types and the equivalent Postgres DDL together so they can't drift; moving to Neon means implementing the same function signatures against it. Every table already carries a nullable `user_id` for when auth lands. See `docs/PRODUCTION.md`.
