# SightLine

AI-powered tech support assistant for Windows that watches your screen in real
time and guides you through technical tasks step by step — no more
screenshot → paste → repeat loop.

You state a task ("help me set up an S3 bucket"), grant screen capture
permission, and SightLine takes a screenshot every few seconds, sends it to
Claude along with full session context, and shows the next instruction in a
floating overlay. The user follows the instruction, the screen updates, and
the cycle repeats until the task is done.

## Stack

- **Electron** — desktop shell, always-on-top transparent overlay window
- **React 18 + TypeScript** — UI
- **Tailwind CSS** — styling
- **Zustand** — state management
- **Anthropic SDK** (`@anthropic-ai/sdk`) — Claude vision calls
- **OpenAI SDK** — Whisper voice transcription
- **keytar** — API keys in the Windows Credential Manager

## Features

- Compact floating panel, always on top, semi-transparent when not in focus
- Draggable (via title bar) and resizable
- Status indicator: Watching / Thinking / Waiting / Paused / Error
- Pause and stop controls — pause halts all capture and API calls
- Follow-up text field with optional Whisper voice input
- Configurable capture interval (2–30 s)
- Multi-monitor selection
- Overlay opacity slider
- Auto-retry on API failure after 10 s; graceful 429 backoff with countdown
- Clear in-panel errors for missing API keys or denied screen permission
- Screenshots kept **in memory only** — never written to disk
- First-launch privacy notice

## Project layout

```
electron/         Electron main + preload (TypeScript)
  main.ts         Window + IPC handlers
  preload.ts      contextBridge API surface
  capture.ts      desktopCapturer wrapper
  claude.ts       Anthropic call + JSON parsing
  whisper.ts      OpenAI Whisper call
  credentials.ts  keytar wrapper
  settings-store.ts  JSON-on-disk settings (non-secret)
src/              React renderer
  App.tsx
  components/
  hooks/
  store/
  lib/
```

## Develop

```sh
npm install
npm run electron:dev
```

`electron:dev` runs Vite on http://localhost:5173 and launches Electron
pointing at it. The preload script is compiled by `tsc -p tsconfig.node.json`
to `dist-electron/preload.js`.

> If `keytar` fails to load with an ABI mismatch, run `npm run rebuild` to
> rebuild native modules against Electron's Node ABI.

## Build a Windows installer

```sh
npm run electron:build:win
```

Produces an NSIS installer in `release/`.

## How a session works

1. User types or speaks a goal.
2. Renderer stores it and flips status to `watching`.
3. The session loop runs every `captureIntervalSec` seconds:
   - Call `capture.once` in the main process → PNG data URL of the chosen
     display.
   - Push the frame to a rolling buffer of the last 5.
   - Set status to `thinking`, call `claude.nextInstruction` with: goal,
     completed-step list, last 10 conversation turns, and the last 5 frames as
     vision input.
   - Claude returns a single instruction in JSON; renderer updates the panel
     and conversation history.
4. The user follows the instruction; the next tick captures the updated screen
   and the cycle repeats.
5. When Claude marks the task `done`, status flips to `waiting` and the loop
   stops.

### Claude system prompt

```
You are a real-time technical support assistant watching the user's screen.
Give ONE clear specific instruction per response referencing exactly what you
see on screen. Keep responses under 60 words. Track completed steps and never
repeat them. If you see an error, address it before continuing.
```

The system prompt also pins Claude to a strict JSON output shape so the
renderer can reliably parse `{ instruction, completed_steps, done }`.

### Error handling

- **Missing API key** — request returns `missing_api_key`; the panel opens
  Settings.
- **429 rate limit** — `Retry-After` header parsed; session pauses with a
  countdown shown next to the status indicator.
- **Other failures** — error surfaced inline; session schedules a retry in
  10 s.
- **Screen capture denied** — error explains how to grant Windows
  screen-recording permission.

### Privacy

- Screenshots are passed straight from `desktopCapturer.getSources` into the
  Anthropic call as base64 in memory — nothing is written to disk.
- API keys live in the Windows Credential Manager (`keytar`), not in
  plain-text config files.
- A hard **Pause** button immediately halts the capture timer and all API
  calls; **Stop** clears the entire session including the frame buffer.
- On first launch a privacy notice spells out what gets sent and where.

## License

MIT
