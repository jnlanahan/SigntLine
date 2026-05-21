# SightLine Enhancement Specifications

**Prepared for engineering handoff — May 2026**
**Priority order: 1 → 4 → 2 → 3** (quick wins first, most-effort feature second)

---

## Feature 1: Adaptive Polling Tiers

### Problem
The session loop runs at a single fixed interval (user-configured, default 15 s). This creates two failure modes:
- **Too slow post-instruction:** The user acts, but SightLine doesn't notice for up to 15 seconds and may issue a redundant follow-up before detecting the screen change.
- **Too fast when idle:** After the user goes silent for 2+ minutes, SightLine keeps polling at full speed, burning API budget on identical screens.

### Goal
Replace the fixed `setInterval` with a self-rescheduling `setTimeout` chain that adapts its delay based on session state.

### Polling Tiers

| Tier | Delay | Condition |
|---|---|---|
| Alert | 2 s | Within 20 s of any instruction being issued |
| Normal | `settings.captureIntervalSec` | Active watching, no special condition |
| Idle | 30 s | 3+ consecutive ticks with no screen change and no pending follow-up |

### Files Changed

#### `src/store/session.ts`
Add one new field and its setter to `SessionState`:

```typescript
// NEW field alongside existing cooldownUntil, lastInstructionAt, etc.
afterInstructionAlertUntil: number | null;

// NEW setter
setAfterInstructionAlertUntil(t: number | null): void;
```

Add to the `initial` object:
```typescript
afterInstructionAlertUntil: null as number | null,
```

Add to the `create` call:
```typescript
setAfterInstructionAlertUntil: (t) => set({ afterInstructionAlertUntil: t }),
```

Note: `idleCycles` and `incrementIdleCycles` / `resetIdleCycles` already exist in the store — no changes needed there.

---

#### `src/hooks/useSessionLoop.ts`
Replace the `setInterval`-based main loop (currently lines 234–264) with a `setTimeout` chain.

**Remove** the entire `useEffect` block at line 234 that creates `timerRef.current = window.setInterval(...)`.

**Replace with:**
```typescript
// Constants — add near the top with the existing ones
const ALERT_INTERVAL_MS = 2_000;
const ALERT_WINDOW_MS = 20_000;
const IDLE_INTERVAL_MS = 30_000;
const IDLE_TICK_THRESHOLD = 3;

// Replace the setInterval useEffect with this setTimeout chain:
useEffect(() => {
  let cancelled = false;

  async function scheduledTick() {
    if (cancelled) return;
    if (useSession.getState().status !== "watching") return;

    await tickRef.current();

    if (cancelled) return;

    // Compute delay for next tick based on current state
    const s = useSession.getState();
    const now = Date.now();
    let delayMs: number;

    if (s.afterInstructionAlertUntil && now < s.afterInstructionAlertUntil) {
      delayMs = ALERT_INTERVAL_MS;
    } else if (s.idleCycles >= IDLE_TICK_THRESHOLD) {
      delayMs = IDLE_INTERVAL_MS;
    } else {
      delayMs = Math.max(2, settings?.captureIntervalSec ?? 15) * 1000;
    }

    timerRef.current = window.setTimeout(scheduledTick, delayMs);
  }

  function start() {
    if (timerRef.current !== null) return;
    // Fire immediately, then self-schedule
    void scheduledTick();
  }

  function stop() {
    cancelled = true;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  if (useSession.getState().status === "watching") start();

  const unsub = useSession.subscribe((state, prev) => {
    if (state.status === prev.status) return;
    if (state.status === "watching") {
      cancelled = false;
      start();
    } else {
      stop();
    }
  });

  return () => {
    unsub();
    stop();
  };
}, [settings?.captureIntervalSec]);
```

**Inside `tick()`, after a non-repeat instruction fires** (currently around line 174 where `setLastInstructionAt` is called):
```typescript
// Set alert window so next ticks run at 2 s
useSession.getState().setAfterInstructionAlertUntil(Date.now() + ALERT_WINDOW_MS);
// User just got an instruction — reset idle count
useSession.getState().resetIdleCycles();
```

**Inside `tick()`, in the "nothing to act on" early return** (currently line 86–89):
```typescript
if (!screenChanged && !hasPendingFollowUp) {
  useSession.getState().incrementIdleCycles(); // NEW
  return;
}
```

**Inside `tick()`, when screen change is detected** (after line 89, before status → "thinking"):
```typescript
useSession.getState().resetIdleCycles(); // NEW — screen changed, not idle anymore
```

### Edge Cases
- If the user changes `captureIntervalSec` in settings mid-session, the new value takes effect on the next scheduled tick (the `settings?.captureIntervalSec` dependency on the `useEffect` will restart the chain).
- `ALERT_WINDOW_MS` (20 s) is independent of the polling delay — it's a timestamp comparison, so even if the previous tick took longer than 2 s, the alert window still expires at the right wall-clock time.
- Alert mode and cooldown can coexist: if `cooldownUntil` is set (2 s post-instruction), the tick still fires at 2 s intervals during alert mode, but the early `cooldownUntil` guard prevents a redundant Claude call. This is intentional — we want to be *ready* to detect the screen change quickly, not trigger a premature API call.

### Testing
1. Start a session. Issue an instruction. Confirm via `console.log` that subsequent ticks fire every ~2 s for 20 s, then revert to the configured interval.
2. Leave the session idle for 3+ full ticks without acting. Confirm ticks slow to ~30 s.
3. Act on the screen after an idle period. Confirm `idleCycles` resets and ticks return to normal speed.
4. Verify rate-limit and pause states still halt polling correctly (they do — the `status !== "watching"` guard at the top of `scheduledTick` handles this).

---

## Feature 2: Spatial Highlight Overlay

### Problem
Claude's instructions reference UI elements by name ("click the Deploy button"), but on a dense console with dozens of similarly-named controls, users spend time hunting. The fix should be AI-initiated — Claude highlights the element as part of the instruction, without the user having to ask.

### Goal
Extend the `InstructionResponse` schema with optional normalized highlight coordinates. When present, a second transparent overlay window renders a pulsing circle at those exact screen coordinates for 3 seconds, then dismisses itself.

### Files Changed

#### `electron/types.ts`
Extend `InstructionResponse` and `IpcChannel`:

```typescript
export interface InstructionResponse {
  instruction: string;
  completedSteps: string[];
  done: boolean;
  needsResearch: boolean;
  researchQuery: string;
  // NEW — optional, normalized 0.0 to 1.0 per axis relative to screenshot dims
  highlightX?: number;
  highlightY?: number;
  highlightLabel?: string; // Short label rendered under the dot, e.g. "Deploy button"
}

// Add to IpcChannel union:
export type IpcChannel =
  | ... // existing entries
  | "overlay:show-highlight";
```

---

#### `electron/claude.ts`
**System prompt addition** — append to `SYSTEM_PROMPT` before the closing backtick:

```
Spatial highlight:
- When your instruction tells the user to click a specific element, add "highlight_x" and "highlight_y" to your JSON output as decimal values 0.0 (left/top) to 1.0 (right/bottom), relative to the latest screenshot's pixel dimensions. Also add "highlight_label" as a short identifier (e.g. "Deploy button", "Permissions tab", "Create bucket").
- Only add highlight coordinates when you can confidently locate the element in the screenshot. If the element is not clearly visible or the screen is ambiguous, omit all three fields.
- Do not add a highlight for pure keyboard steps (typing, pressing Enter) — only for click targets.
```

**Schema line in system prompt** — update the schema description:
```
Schema: {"instruction": string, "completed_steps": string[], "done": boolean, "needsResearch": boolean, "researchQuery": string, "highlight_x"?: number, "highlight_y"?: number, "highlight_label"?: string}
```

**`parseInstruction` function** — extend the return object:
```typescript
// Add to the returned object inside the try block:
highlightX: typeof obj.highlight_x === "number"
  ? Math.max(0, Math.min(1, obj.highlight_x))
  : undefined,
highlightY: typeof obj.highlight_y === "number"
  ? Math.max(0, Math.min(1, obj.highlight_y))
  : undefined,
highlightLabel: typeof obj.highlight_label === "string"
  ? obj.highlight_label.trim().slice(0, 60) // cap length for safety
  : undefined,
```

---

#### `electron/main.ts`
Add `highlightWindow` alongside the existing `glowWindow`, and a new IPC handler.

**At the top, after `let glowWindow`:**
```typescript
let highlightWindow: BrowserWindow | null = null;
```

**New HTML template function** (add near `GLOW_HTML`):
```typescript
function buildHighlightHtml(x: number, y: number, label: string): string {
  const px = (x * 100).toFixed(2);
  const py = (y * 100).toFixed(2);
  const escapedLabel = label.replace(/[<>"&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" }[c] ?? c),
  );
  return `<!DOCTYPE html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100vw;height:100vh;overflow:hidden;background:transparent;pointer-events:none}
.dot{
  position:fixed;width:40px;height:40px;border-radius:50%;
  background:rgba(99,102,241,0.55);border:3px solid #6366f1;
  left:${px}%;top:${py}%;transform:translate(-50%,-50%);
  animation:pulse 0.75s ease-in-out 3,fade 0.4s 2.6s forwards;
  box-shadow:0 0 24px rgba(99,102,241,0.7)
}
.label{
  position:fixed;font:600 12px/1.2 system-ui,sans-serif;color:#fff;
  background:rgba(99,102,241,0.92);padding:3px 8px;border-radius:4px;
  left:${px}%;top:calc(${py}% + 26px);transform:translateX(-50%);
  white-space:nowrap;animation:fade 0.4s 2.6s forwards
}
@keyframes pulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.5)}}
@keyframes fade{to{opacity:0}}
</style></head><body>
<div class="dot"></div>
${escapedLabel ? `<div class="label">${escapedLabel}</div>` : ""}
</body></html>`;
}
```

**New functions** (add after `hideGlowOverlay`):
```typescript
function showHighlightOverlay(
  displayId: string | null,
  x: number,
  y: number,
  label: string,
) {
  if (highlightWindow && !highlightWindow.isDestroyed()) {
    highlightWindow.close();
    highlightWindow = null;
  }

  const all = screen.getAllDisplays();
  const target =
    (displayId ? all.find((d) => String(d.id) === displayId) : null) ??
    screen.getPrimaryDisplay();

  const { x: bx, y: by, width, height } = target.bounds;

  highlightWindow = new BrowserWindow({
    x: bx,
    y: by,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  highlightWindow.setIgnoreMouseEvents(true, { forward: true });
  highlightWindow.setAlwaysOnTop(true, "screen-saver");
  highlightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  void highlightWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildHighlightHtml(x, y, label))}`,
  );

  highlightWindow.on("closed", () => { highlightWindow = null; });

  // Auto-dismiss after 3 s (the CSS animation finishes at ~3 s too)
  setTimeout(() => {
    if (highlightWindow && !highlightWindow.isDestroyed()) {
      highlightWindow.close();
      highlightWindow = null;
    }
  }, 3000);
}

function hideHighlightOverlay() {
  if (highlightWindow && !highlightWindow.isDestroyed()) {
    highlightWindow.close();
    highlightWindow = null;
  }
}
```

**New IPC handler** (add inside `registerIpc()`):
```typescript
ipcMain.handle(
  "overlay:show-highlight",
  (
    _e: IpcMainInvokeEvent,
    payload: { displayId: string | null; x: number; y: number; label: string },
  ) => {
    if (
      typeof payload.x !== "number" ||
      typeof payload.y !== "number" ||
      payload.x < 0 || payload.x > 1 ||
      payload.y < 0 || payload.y > 1
    ) return; // ignore malformed coordinates
    showHighlightOverlay(payload.displayId ?? null, payload.x, payload.y, payload.label ?? "");
  },
);
```

**In `mainWindow.on("closed")`** — add cleanup:
```typescript
mainWindow.on("closed", () => {
  hideGlowOverlay();
  hideHighlightOverlay(); // NEW
  mainWindow = null;
});
```

---

#### `electron/preload.ts`
Extend the `overlay` namespace in `SightLineApi` and the `api` object:

```typescript
// In SightLineApi interface:
overlay: {
  showGlow(displayId: string | null): Promise<void>;
  hideGlow(): Promise<void>;
  showHighlight(payload: {   // NEW
    displayId: string | null;
    x: number;
    y: number;
    label?: string;
  }): Promise<void>;
};

// In the api object:
overlay: {
  showGlow: (displayId) => ipcRenderer.invoke("overlay:show-glow", { displayId }),
  hideGlow: () => ipcRenderer.invoke("overlay:hide-glow"),
  showHighlight: (payload) => ipcRenderer.invoke("overlay:show-highlight", payload), // NEW
},
```

---

#### `src/hooks/useSessionLoop.ts`
After the block that calls `setInstruction` and speaks the instruction (around line 167, inside `if (!isRepeat)`), add:

```typescript
// Trigger spatial highlight if Claude provided coordinates
if (
  result.highlightX !== undefined &&
  result.highlightY !== undefined &&
  !result.done
) {
  const displayId = useSettings.getState().settings?.selectedDisplayId ?? null;
  void api().overlay.showHighlight({
    displayId,
    x: result.highlightX,
    y: result.highlightY,
    label: result.highlightLabel ?? "",
  });
}
```

### Edge Cases
- If Claude returns coordinates outside 0.0–1.0 (hallucinated), the IPC handler silently ignores the payload (guard is in `main.ts`).
- If a new instruction fires before the 3 s dismiss, the old `highlightWindow` is closed and replaced immediately in `showHighlightOverlay`.
- The highlight window sits on top of the glow window (`"screen-saver"` z-order for both). This is fine — they serve different purposes and both should be visible.
- On `done: true`, the `!result.done` guard prevents a highlight from appearing on the completion message.
- The label text is HTML-escaped in `buildHighlightHtml` to prevent injection via Claude's output.

### Testing
1. Start an AWS S3 session. When Claude says "click the Create bucket button", verify a pulsing indigo dot appears at approximately the right screen position and disappears after 3 s.
2. Check that no highlight appears on a step like "Type `my-app-files` as the bucket name" (keyboard-only step).
3. Force a screen with ambiguous UI (e.g., a blank desktop) and verify Claude omits the highlight fields — no dot should appear.
4. Trigger two rapid instructions and confirm the second dot correctly replaces the first.

---

## Feature 3: Confidence Field

### Problem
When Claude can't clearly read the screen state, it still delivers instructions in confident-sounding imperative language ("Click the Deploy button"). If the screen is ambiguous — a loading spinner, a dark-themed console Claude hasn't seen before — the user may follow a wrong instruction without any signal that Claude is uncertain.

### Goal
Add a `confidence` field to the `InstructionResponse` schema. Low-confidence instructions get a distinct visual treatment in the UI so users know to double-check before acting.

### Design Decisions
- **Three tiers** (high / medium / low) rather than a numeric score — easier for Claude to reason about and easier to map to visual treatments.
- **High is the default** — if Claude omits the field or returns an unrecognized value, the parser defaults to "high". This prevents noise on the common case.
- **Low triggers softer language in the instruction text itself** — the system prompt instructs Claude to phrase low-confidence instructions tentatively ("I think…", "It looks like…"). The visual badge reinforces, not replaces, the verbal cue.

### Files Changed

#### `electron/types.ts`
```typescript
// NEW type — add before InstructionResponse
export type InstructionConfidence = "high" | "medium" | "low";

// Extend InstructionResponse:
export interface InstructionResponse {
  instruction: string;
  completedSteps: string[];
  done: boolean;
  needsResearch: boolean;
  researchQuery: string;
  highlightX?: number;     // from Feature 2
  highlightY?: number;     // from Feature 2
  highlightLabel?: string; // from Feature 2
  confidence: InstructionConfidence; // NEW — defaults to "high" if absent
}
```

---

#### `electron/claude.ts`
**System prompt addition** — append to `SYSTEM_PROMPT`:

```
Confidence:
- Add "confidence": "high" when you can clearly read the screen and are certain about the next step.
- Add "confidence": "medium" when the screen is partially visible or slightly ambiguous but you have a reasonable interpretation.
- Add "confidence": "low" when you cannot clearly identify the current screen state or the right next action. In this case, soften your instruction language ("I think you're on the…", "It looks like you need to…") and prefer asking a clarifying question over issuing a potentially wrong directive.
```

**Schema line update:**
```
Schema: {"instruction": string, "completed_steps": string[], "done": boolean, "needsResearch": boolean, "researchQuery": string, "highlight_x"?: number, "highlight_y"?: number, "highlight_label"?: string, "confidence": "high"|"medium"|"low"}
```

**`parseInstruction` function** — add to the returned object:
```typescript
confidence: (["high", "medium", "low"] as const).includes(obj.confidence as InstructionConfidence)
  ? (obj.confidence as InstructionConfidence)
  : "high",
```

---

#### `src/components/Instruction.tsx`
The component currently renders `currentInstruction` as plain text. Extend it to accept a `confidence` prop and apply conditional styling.

Read the current `confidence` from the session store (see note below on store change), or pass it as a prop from the parent.

**Visual treatments:**
```
high (default):   No change from current styling.
medium:           Instruction text at 80% opacity. A small amber left border on the card.
low:              Instruction text at 65% opacity. Amber background tint (rgba(251,191,36,0.08)).
                  A small badge in the top-right corner: "?" in amber — 10px, semi-transparent.
```

Example Tailwind classes (adjust to match existing design system):
```
medium: "border-l-2 border-amber-400 opacity-80"
low:    "bg-amber-400/8 opacity-65 relative" + badge: "absolute top-1 right-1 text-amber-400 text-xs font-bold"
```

**Store change needed** — add `confidence` to session state so `Instruction.tsx` can read it:

In `src/store/session.ts`, add:
```typescript
// In SessionState interface:
currentConfidence: InstructionConfidence;
setConfidence(c: InstructionConfidence): void;

// In initial object:
currentConfidence: "high" as InstructionConfidence,

// In create():
setConfidence: (c) => set({ currentConfidence: c }),
```

In `src/hooks/useSessionLoop.ts`, after `setInstruction(result.instruction)`:
```typescript
useSession.getState().setConfidence(result.confidence ?? "high"); // NEW
```

In `reset()` in the store, reset `currentConfidence` back to `"high"`.

### Edge Cases
- If Claude ignores the field (possible on first few calls or after a context-length truncation), the parser defaults to `"high"` — no visual change.
- On `done: true`, the done-state UI replaces the instruction card entirely, so confidence styling is moot.
- Medium and low visual treatments must pass WCAG AA contrast on both the light and dark variants of the SightLine panel. Verify with the amber opacity values.

### Testing
1. Capture a screenshot of a dark terminal with small text. Verify Claude returns `"confidence": "low"` and the instruction card shows amber treatment.
2. Verify that normal AWS console screenshots produce `"confidence": "high"` with no visual change.
3. Check that a session `reset()` clears confidence back to "high" so stale amber styling doesn't bleed into the next session.

---

## Feature 4: Claude Web Search for Research

### Problem
The current `research:search` handler calls the DuckDuckGo Instant Answer API, which returns Wikipedia-style abstract snippets. For technical documentation queries ("Terraform aws_s3_bucket arguments", "GitHub Actions permissions syntax"), these snippets are often thin, outdated, or completely empty.

### Goal
Replace the DuckDuckGo call with Claude's native web_search tool. Claude searches the live web, incorporates documentation content, and returns a summarized, actionable excerpt — all within the existing "researching" status flow that is already invisible to the user.

### Approach
Use the Anthropic API's `web_search` tool via tool use. Claude receives the query, searches the web as a tool call, reads the results, and returns a text summary. The handler returns that summary as `{ text: string }` — the same shape the caller already expects.

### Files Changed

#### `electron/main.ts`
Replace the `research:search` IPC handler body (currently lines 339–361) entirely.

**New imports needed at top of file** (if not already present — `getKey` is already imported via `credentials`):
The existing `getKey` import from `./credentials` is sufficient. Add `Anthropic` if not already imported — but `claude.ts` already handles the Anthropic client; for research, it's cleaner to make the call here or extract to a helper.

**Recommended:** Add a `searchForContext` function to `electron/claude.ts` (keeps all Anthropic API calls in one place), then call it from `main.ts`.

**In `electron/claude.ts`**, add after `getClarifications`:

```typescript
export async function searchForContext(query: string): Promise<string> {
  const apiKey = await getKey("anthropic");
  if (!apiKey) throw new MissingApiKeyError();

  const client = new Anthropic({ apiKey });

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    // web_search is an Anthropic-hosted tool — no custom tool definition needed.
    // Verify the exact tool type string against current API docs before shipping.
    tools: [{ type: "web_search_20250305", name: "web_search" } as Anthropic.Tool],
    tool_choice: { type: "auto" },
    system:
      "You are a technical documentation researcher. Search for the most relevant and current information from official documentation. " +
      "Summarize the key facts in 2-3 concise paragraphs focused on actionable details: specific menu paths, UI element names, required fields, " +
      "or syntax. Avoid marketing language. If the search returns nothing useful, say so briefly.",
    messages: [
      { role: "user", content: `Find current documentation for: ${query}` },
    ],
  });

  // Extract text blocks from the response (Claude will have used web_search internally)
  const text = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();

  return text || "(No relevant documentation found.)";
}
```

**In `electron/main.ts`**, import `searchForContext`:
```typescript
import {
  getClarifications,
  getNextInstruction,
  searchForContext, // NEW
  MissingApiKeyError,
  RateLimitError,
} from "./claude";
```

**Replace the `research:search` handler:**
```typescript
ipcMain.handle(
  "research:search",
  async (_e: IpcMainInvokeEvent, payload: { query: string }) => {
    try {
      const text = await searchForContext(payload.query);
      return { text };
    } catch (err) {
      // Fallback: if Claude web search fails (API unavailable, key issue, etc.),
      // fall back to the DuckDuckGo instant-answer call so research never silently dies.
      console.warn("[research] Claude web search failed, falling back to DuckDuckGo:", err);
      try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(payload.query)}&format=json&no_html=1&skip_disambig=1`;
        const r = await fetch(url, { headers: { "User-Agent": "SightLine/0.1.0" } });
        const data = await r.json() as {
          AbstractText?: string;
          Answer?: string;
          RelatedTopics?: Array<{ Text?: string }>;
        };
        const parts: string[] = [];
        if (data.Answer) parts.push(data.Answer);
        if (data.AbstractText) parts.push(data.AbstractText);
        if (Array.isArray(data.RelatedTopics)) {
          for (const t of data.RelatedTopics.slice(0, 5)) {
            if ("Text" in t && t.Text) parts.push(t.Text);
          }
        }
        return { text: parts.join("\n\n") };
      } catch (fallbackErr) {
        return { __error: "fetch_failed", message: String(fallbackErr) };
      }
    }
  },
);
```

### Important Notes for Engineers

**1. Tool type string** — The `web_search_20250305` type string must match the current Anthropic API. Check the [Anthropic tool use docs](https://docs.anthropic.com/en/docs/tool-use) before shipping — this string may have been updated since the spec was written.

**2. Beta header** — Early versions of the web_search tool required the header `anthropic-beta: web-search-20250305`. The Anthropic SDK may handle this automatically when the tool type is specified, but confirm in the current SDK release notes.

**3. Latency** — The DuckDuckGo call completes in ~200 ms. The Claude web search call will take 3–8 s. This is acceptable because:
- Research only fires when `needsResearch: true` (Claude already decided it's blocked)
- The session status shows "researching" with a spinner during this time
- The user sees no difference — they never saw the raw research results anyway

**4. Token cost** — Each research call uses up to 1000 output tokens plus the tool result tokens. Research is gated behind `needsResearch: true` which Claude sets conservatively (the system prompt says "ONLY when you are genuinely blocked"). This should be rare — typically 0–1 times per session.

**5. No new API key required** — This reuses the existing `ANTHROPIC_API_KEY`. No additional credentials to manage.

### Testing
1. Start a session on a technical task that requires current documentation (e.g., "Set up an ECS Fargate service"). Cause Claude to set `needsResearch: true` by making the goal require obscure CLI flags. Verify the `researching` status appears, then resolves with a correct follow-up instruction informed by real docs.
2. Temporarily break the Anthropic key to force the fallback path. Verify the DuckDuckGo fallback fires and the session continues rather than crashing.
3. Log the `clarificationContext` string after a research cycle. Verify it contains a useful paragraph of documentation text rather than a Wikipedia abstract.
4. Verify no user-visible change to the UI — the research step should be completely invisible from the user's perspective.

---

## Shared Verification Checklist

Before shipping any of these features:

- [ ] TypeScript compiles without errors (`tsc --noEmit`)
- [ ] No new `console.error` output appears in normal operation
- [ ] Session `reset()` clears all new state fields (confidence, afterInstructionAlertUntil, etc.)
- [ ] Pause / Stop buttons still halt all activity immediately
- [ ] Privacy contract maintained: no screenshots written to disk (unchanged by all four features)
- [ ] Rate limit backoff still works correctly (test by temporarily lowering the rate limit threshold)
- [ ] The app still loads and runs correctly when no Anthropic key is configured
