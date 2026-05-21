# Dev Notes

## May 2026 — Adaptive Polling, Input Triggers, Bug Fixes

**Branch:** `feature/adaptive-polling-tiers`

---

### What was built

#### Feature 1: Adaptive Polling Tiers *(from ENHANCEMENTS-SPEC.md)*
Replaced the fixed `setInterval` loop with a self-rescheduling `setTimeout` chain. Three tiers:

| Tier | Delay | Condition |
|---|---|---|
| Alert | 2 s | Within 20 s of any instruction |
| Normal | `captureIntervalSec` (default 15 s) | Active, no special state |
| Idle | 30 s | 3+ ticks with no screen change |

New session state: `afterInstructionAlertUntil: number | null`  
Files changed: `src/store/session.ts`, `src/hooks/useSessionLoop.ts`

---

#### Input-Triggered Screen Checks *(user-designed, not in spec)*
Global mouse click + keyboard monitoring via `uiohook-napi`. When the user acts, a debounced tick fires immediately instead of waiting for the next poll timer.

- 750 ms debounce (prevents spam on rapid typing/clicking)
- **Suppressed during the 20 s alert window** — during that window the timer already runs at 2 s, and allowing input triggers on top of it caused TTS to be constantly interrupted mid-sentence
- Only fires when `status === "watching"`

Files changed: `electron/main.ts`, `electron/preload.ts`, `src/hooks/useSessionLoop.ts`

---

### Gotchas & lessons learned

**TTS always cancels on new instruction.**  
`speak()` in `src/hooks/useTts.ts` unconditionally calls `cancelCurrent()` before starting any new audio. This means a new Claude response always cuts off in-progress speech. The input trigger was causing this by firing during the alert window, generating rapid-fire new instructions. Fix: check `afterInstructionAlertUntil` in the input handler and return early if it hasn't expired.

**Claude narrates screen state without explicit guidance.**  
Without a prohibition, Claude would include observations like "Pop-up closed, now click X" or "The dialog appeared" in its instruction text. Added to `SYSTEM_PROMPT` in `electron/claude.ts`: *"Never narrate what just happened on screen — just give the next action directly."*

**`uiohook-napi` must be stopped on window close.**  
Call `uIOhook.stop()` in `mainWindow.on('closed')` or the Electron process will hang. Also clear the debounce timer there.

**Session store `reset()` is automatic for new fields.**  
`reset()` spreads `...initial`. Any field added to the `initial` object is automatically included in resets — no need to add it to the `reset()` call explicitly.

**IPC pattern to follow for new channels:**
1. Add handler in `registerIpc()` in `electron/main.ts`
2. Add method to `SightLineApi` interface in `electron/preload.ts`
3. Add implementation to the `api` object in `electron/preload.ts`
4. Channel names use `namespace:action` format (e.g. `overlay:show-glow`)
5. `src/lib/api.ts` only re-exports the type — no changes needed there for new channels

**Tick safety guards already in place.**  
`tick()` has `inFlightRef` (no concurrent ticks), `cooldownUntil` (2 s post-instruction), and `rateLimitUntil` (API backoff). Any code that calls `tickRef.current()` externally inherits all these guards for free.

---

### Enhancement spec status (`ENHANCEMENTS-SPEC.md`)
Priority order from spec: **1 → 4 → 2 → 3**

- [x] Feature 1: Adaptive Polling Tiers
- [ ] Feature 4: Claude Web Search for Research *(next up)*
- [ ] Feature 2: Spatial Highlight Overlay
- [ ] Feature 3: Confidence Field
