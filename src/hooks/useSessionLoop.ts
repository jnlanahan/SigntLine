import { useCallback, useEffect, useRef } from "react";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { hashFrame, hashesAreSimilar } from "../lib/frameHash";
import {
  openSpeechStream,
  randomCompletionPhrase,
  randomThinkingPhrase,
  waitForSpeechEnd,
  isSpeaking,
  type SpeechStream,
} from "./useTts";
import { useQuietPeriod } from "./useQuietPeriod";
import type { AppMode, StepPace } from "../lib/api";

const RETRY_DELAY_MS = 10_000;

// Tech-support pacing. The loop looks at the screen often; Claude decides
// each tick whether to speak ("instruct"/"acknowledge"/"check_in"/"done")
// or stay silent ("wait"), so frequent ticks don't rush the user.
const TS_MIN_CALL_SPACING_MS = 5_000;
const TS_BACKSTOP_MS = 15_000;
const TS_SLOW_BACKSTOP_MS = 30_000;
const TS_SLOW_AFTER_MS = 120_000; // screen still this long → slow backstop
const TS_QUIET_PERIOD_MS = 3_500; // silence after input before a check

// How long the screen must be still before a stall tick (which lets Claude
// check in), scaled by the expected pace of the current step.
const STALL_THRESHOLD_MS: Record<StepPace, number> = {
  quick: 18_000,
  medium: 45_000,
  long: 90_000,
};
const CHECK_IN_REPEAT_MS = 60_000;
// A digression normally suppresses stall check-ins (don't pester someone on a
// break) — but if the screen has been STILL this long while "diverted", the
// digression call was probably wrong (e.g. watching the wrong monitor), so
// let a check-in through rather than staying silent forever.
const DIVERTED_STALL_MS = 120_000;

type ModeConfig = {
  // Minimum time between Claude calls, stamped when the call is made.
  minCallSpacingMs: number;
  // Backstop auto-poll interval (ms). 0 = no auto-poll (teacher mode).
  normalIntervalMs: number;
  // Backstop when the screen has been still for a long time.
  slowIntervalMs: number;
  // ms of silence after last input before triggering a check. 0 = disabled.
  quietPeriodMs: number;
  // Whether ticks may proceed without a screen change to let Claude check in.
  stallEnabled: boolean;
  // If true, skip the Claude call unless screen changed or follow-up pending.
  // If false (teacher), ONLY fire when there's a pending follow-up.
  requireScreenChange: boolean;
};

function getModeConfig(mode: AppMode | null): ModeConfig {
  switch (mode) {
    case "training":
      return {
        minCallSpacingMs: 10_000,
        normalIntervalMs: 60_000,
        slowIntervalMs: 60_000,
        quietPeriodMs: 0, // no input trigger in training
        stallEnabled: false,
        requireScreenChange: true,
      };
    case "teacher":
      return {
        minCallSpacingMs: 2_000,
        normalIntervalMs: 0, // no auto-poll — conversation-driven only
        slowIntervalMs: 0,
        quietPeriodMs: 0,
        stallEnabled: false,
        requireScreenChange: false,
      };
    default: // tech_support
      return {
        minCallSpacingMs: TS_MIN_CALL_SPACING_MS,
        normalIntervalMs: TS_BACKSTOP_MS,
        slowIntervalMs: TS_SLOW_BACKSTOP_MS,
        quietPeriodMs: TS_QUIET_PERIOD_MS,
        stallEnabled: true,
        requireScreenChange: true,
      };
  }
}

function instructionsAreSimilar(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb;
}

export function useSessionLoop(onNeedsApiKey: () => void, focused: boolean) {
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const tickRef = useRef<() => Promise<void>>(async () => {});
  const focusedRef = useRef(focused);

  const settings = useSettings((s) => s.settings);

  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  const tick = useCallback(async () => {
    if (inFlightRef.current) return;
    const state = useSession.getState();
    if (state.status !== "watching") return;
    if (!state.goal) return;

    const now = Date.now();
    if (state.rateLimitUntil && now < state.rateLimitUntil) return;

    const cfg = getModeConfig(state.mode);

    // Minimum spacing between Claude calls. Stamped when the call is made,
    // so a skipped or deduped response can never wedge the loop. A pending
    // follow-up bypasses the spacing — a direct question deserves a direct
    // answer, not "in a few seconds".
    if (
      state.lastClaudeCallAt &&
      now - state.lastClaudeCallAt < cfg.minCallSpacingMs &&
      !state.pendingFollowUp
    )
      return;

    // Teacher mode: only fire when the user has sent a follow-up message.
    if (!cfg.requireScreenChange && !state.pendingFollowUp) return;

    inFlightRef.current = true;
    // One speech stream per tick: the thinking filler (if any) plays first,
    // then instruction sentences queue behind it as they stream in — nothing
    // gets hard-cancelled mid-word within the same response. (Holder object
    // because TS flow analysis can't see closure assignments to a `let`.)
    const speech: { stream: SpeechStream | null } = { stream: null };
    let unsubEarly: (() => void) | null = null;
    const ttsOn = () => Boolean(useSettings.getState().settings?.ttsEnabled);
    const speakOut = (text: string) => {
      if (!ttsOn() || !text.trim()) return;
      if (!speech.stream) speech.stream = openSpeechStream();
      speech.stream.enqueue(text);
    };
    try {
      // 1. Capture frame
      const displayId = useSettings.getState().settings?.selectedDisplayId ?? null;
      let frame;
      try {
        frame = await api().capture.once(displayId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useSession.getState().setError(
          `Capture failed: ${msg}. Check screen-recording permission.`,
        );
        useSession.getState().setStatus("error");
        return;
      }
      useSession.getState().pushFrame(frame);

      // 2. Screen-change detection — filters cursor jitter, blinking carets.
      const newHash = await hashFrame(frame.dataUrl);
      const lastHash = useSession.getState().lastProcessedHash;
      const screenChanged = !hashesAreSimilar(newHash, lastHash ?? "");
      if (screenChanged) {
        useSession.getState().setLastScreenChangeAt(now);
      }
      const s0 = useSession.getState();
      const hasPendingFollowUp = Boolean(s0.pendingFollowUp);

      const sinceChangeMs = now - (s0.lastScreenChangeAt ?? now);
      const sinceSpokeMs = now - (s0.lastSpokeAt ?? now);

      // Stall ladder: when the screen has been still longer than the current
      // step should take (pace-scaled), proceed anyway so Claude can look and
      // either stay silent ("wait") or check in. Suppressed while the user is
      // off on a digression and rate-limited to one check-in per minute.
      const stallThresholdMs = STALL_THRESHOLD_MS[s0.currentPace];
      const stalled =
        cfg.stallEnabled &&
        (!s0.diverted || sinceChangeMs >= DIVERTED_STALL_MS) &&
        s0.lastSpokeAt !== null &&
        sinceChangeMs >= stallThresholdMs &&
        sinceSpokeMs >= stallThresholdMs &&
        (!s0.lastCheckInAt || now - s0.lastCheckInAt >= CHECK_IN_REPEAT_MS);

      if (cfg.requireScreenChange && !screenChanged && !hasPendingFollowUp && !stalled) {
        return;
      }

      // 3. Ask Claude. We deliberately do NOT cancel any in-flight TTS here
      //    — the peek phrase should keep playing while Claude thinks.
      useSession.getState().setLastClaudeCallAt(now);
      useSession.getState().setStatus("thinking");
      const s = useSession.getState();

      // Consume pending follow-up
      const followUp = s.pendingFollowUp ?? undefined;
      if (s.pendingFollowUp) {
        useSession.getState().setPendingFollowUp(null);
      }

      // The user asked a direct question and is now waiting on a multi-second
      // vision call. A short spoken filler ("Let me take a look.") bridges the
      // gap; the answer queues behind it in the same stream. Skipped while
      // other audio is playing so we never cut ourselves off.
      if (followUp && !isSpeaking()) {
        speakOut(randomThinkingPhrase());
      }

      // Subscribe to sentence-level speech chunks — the first one fires as
      // soon as the first sentence of the instruction exists in the Claude
      // stream (never for "wait"), so speech starts while Claude is still
      // writing the rest.
      let earlySpoken = false;
      unsubEarly = api().claude.onSpeechChunk((chunk) => {
        if (!ttsOn()) return;
        // While the user is off on a digression, stay quiet — the full
        // response handler below decides if there's something new to say.
        if (useSession.getState().diverted) return;
        speakOut(chunk.text);
        earlySpoken = true;
        useSession.getState().setLastSpokeAt(Date.now());
      });

      // First look after session start: the model is told to give the first
      // step immediately (never "wait", never a false "digression").
      const sessionJustStarted = !s.conversation.some(
        (t) => t.role === "assistant",
      );

      const result = await api().claude.nextInstruction({
        mode: s.mode ?? "tech_support",
        goal: s.goal!,
        completedSteps: s.completedSteps,
        conversation: s.conversation,
        frames: s.frames,
        followUp,
        clarificationContext: s.clarificationContext,
        uploadedContext: s.uploadedContext,
        agentNotes: s.agentNotes,
        secondsSinceScreenChange: Math.round(sinceChangeMs / 1000),
        secondsSinceLastSpoke: s.lastSpokeAt
          ? Math.round(sinceSpokeMs / 1000)
          : undefined,
        stalled,
        sessionJustStarted,
      });

      // Handle error envelope
      if (result && typeof result === "object" && "__error" in result) {
        const err = result as {
          __error: string;
          retryAfterSec?: number;
          message?: string;
        };
        if (err.__error === "missing_api_key") {
          useSession.getState().setStatus("paused");
          useSession.getState().setError("Anthropic API key is not configured.");
          onNeedsApiKey();
          return;
        }
        if (err.__error === "rate_limited") {
          const wait = (err.retryAfterSec ?? 30) * 1000;
          useSession.getState().setRateLimit(Date.now() + wait);
          useSession.getState().setStatus("watching");
          useSession.getState().setError(
            `Rate limited. Backing off for ${err.retryAfterSec ?? 30}s.`,
          );
          return;
        }
        useSession.getState().setError(
          err.message ?? "Request failed. Retrying in 10s.",
        );
        useSession.getState().setStatus("watching");
        useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
        return;
      }

      // 4. Update state — these apply on EVERY action, including "wait",
      //    so Claude can mark progress silently.
      useSession.getState().setError(null);
      useSession.getState().setRateLimit(null);
      useSession.getState().setLastProcessedHash(newHash);
      useSession.getState().setCompletedSteps(result.completedSteps);
      useSession.getState().setUpcomingSteps(result.upcomingSteps ?? []);

      if (result.notes && result.notes.trim().length > 0) {
        useSession.getState().appendAgentNote(result.notes.trim());
      }

      // Digression: user navigated away from the task. Speak the warm pause
      // message ONCE, then keep watching silently — the loop auto-resumes
      // when the screen shows the task again (no typed follow-up needed).
      if (result.digression) {
        const alreadyDiverted = useSession.getState().diverted;
        useSession.getState().setDiverted(true);
        if (!alreadyDiverted && result.instruction) {
          useSession.getState().setInstruction(result.instruction);
          useSession.getState().appendTurn({
            role: "assistant",
            content: result.instruction,
            timestamp: Date.now(),
          });
          useSession.getState().setLastSpokeAt(Date.now());
          if (!earlySpoken) speakOut(result.instruction);
        }
        useSession.getState().setStatus("watching");
        return;
      }
      // Any substantive response while diverted means the user is back on task.
      if (
        useSession.getState().diverted &&
        (result.action === "instruct" ||
          result.action === "acknowledge" ||
          result.action === "done")
      ) {
        useSession.getState().setDiverted(false);
      }

      if (sessionJustStarted && result.action === "wait") {
        api().log(
          "[loop] first tick returned wait despite sessionJustStarted — stall ladder will recover",
        );
      }

      // Dedupe safety net (instruct only): if Claude repeated itself
      // verbatim, treat it as a wait instead of speaking again. State and
      // call spacing are already stamped, so this can never wedge the loop.
      let action = result.action;
      if (
        action === "instruct" &&
        result.instruction &&
        instructionsAreSimilar(
          result.instruction,
          useSession.getState().lastSpokenInstruction ?? "",
        )
      ) {
        api().log("[loop] repeated instruction suppressed; treating as wait");
        action = "wait";
      }

      switch (action) {
        case "wait":
          break;

        case "instruct": {
          useSession.getState().setInstruction(result.instruction);
          useSession.getState().appendTurn({
            role: "assistant",
            content: result.instruction,
            timestamp: Date.now(),
          });
          useSession.getState().setLastSpokenInstruction(result.instruction);
          useSession.getState().setLastSpokeAt(Date.now());
          useSession.getState().setCurrentPace(result.expectedPace);
          if (!earlySpoken) speakOut(result.instruction);
          break;
        }

        case "acknowledge":
        case "check_in": {
          useSession.getState().appendTurn({
            role: "assistant",
            content: result.instruction,
            timestamp: Date.now(),
          });
          useSession.getState().setLastSpokeAt(Date.now());
          if (action === "check_in") {
            useSession.getState().setLastCheckInAt(Date.now());
          }
          if (!earlySpoken) speakOut(result.instruction);
          break;
        }

        case "done": {
          useSession.getState().setInstruction(result.instruction);
          useSession.getState().appendTurn({
            role: "assistant",
            content: result.instruction,
            timestamp: Date.now(),
          });
          useSession.getState().setLastSpokenInstruction(result.instruction);
          useSession.getState().setLastSpokeAt(Date.now());
          useSession.getState().setDone(true);
          // If the instruction already streamed out, just add the wrap-up —
          // it queues behind the still-playing sentences.
          if (earlySpoken) speakOut(randomCompletionPhrase());
          else speakOut(`${result.instruction} ${randomCompletionPhrase()}`);
          break;
        }
      }

      // Research signal — auto-fetch and resume without user intervention
      if (result.needsResearch && result.researchQuery) {
        const query = result.researchQuery;
        useSession.getState().setResearchQuery(query);
        useSession.getState().setStatus("researching");

        void (async () => {
          const research = await api().research.search(query);
          if (!("__error" in research) && research.text) {
            const ctx = useSession.getState().clarificationContext ?? "";
            const addition = `[Research: "${query}"]\n${research.text}`;
            useSession
              .getState()
              .setClarificationContext(ctx ? `${ctx}\n\n${addition}` : addition);
          }
          useSession.getState().setStatus("watching");
        })();

        return;
      }

      // "waiting" is reached ONLY when the goal is done — a legitimate stop.
      // submitFollowUp resumes from it.
      if (action === "done") {
        useSession.getState().setStatus("waiting");
      } else {
        useSession.getState().setStatus("watching");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useSession.getState().setError(msg);
      useSession.getState().setStatus("watching");
      useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
    } finally {
      unsubEarly?.();
      // Close the stream so waitForSpeechEnd() resolves once the queued
      // audio drains. Anything already enqueued still plays to the end.
      speech.stream?.end();
      inFlightRef.current = false;
    }
  }, [onNeedsApiKey]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Main capture loop — self-rescheduling setTimeout chain.
  useEffect(() => {
    let cancelled = false;

    async function scheduledTick() {
      if (cancelled) return;
      if (useSession.getState().status !== "watching") return;

      // Never talk over ourselves: if audio is still playing (e.g. the plan
      // overview right after session start), let it finish before looking at
      // the screen — the capture is fresher afterwards anyway.
      await waitForSpeechEnd();
      if (cancelled) return;

      await tickRef.current();

      // Wait for any TTS audio to finish before scheduling the next tick.
      // Prevents the next instruction from firing while the current one is still speaking.
      await waitForSpeechEnd();

      if (cancelled) return;

      const s = useSession.getState();
      const cfg = getModeConfig(s.mode);

      // Teacher mode has no auto-poll — loop exits here and restarts only
      // when a follow-up is submitted (see the pendingFollowUp watcher below).
      if (cfg.normalIntervalMs === 0) return;

      // After a long stretch with no screen change, slow the backstop down.
      const sinceChangeMs = Date.now() - (s.lastScreenChangeAt ?? Date.now());
      const delayMs =
        sinceChangeMs > TS_SLOW_AFTER_MS
          ? cfg.slowIntervalMs
          : cfg.normalIntervalMs;

      timerRef.current = window.setTimeout(scheduledTick, delayMs);
    }

    function start() {
      if (timerRef.current !== null) return;
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

  // Fire a tick immediately whenever a follow-up is submitted, in every
  // mode — a direct question shouldn't wait for the next poll. In teacher
  // mode this is the ONLY trigger (the scheduled loop exits immediately,
  // normalIntervalMs = 0).
  useEffect(() => {
    const unsub = useSession.subscribe((state, prev) => {
      if (state.pendingFollowUp === prev.pendingFollowUp) return;
      if (!state.pendingFollowUp) return;
      if (state.status !== "watching") return;
      void tickRef.current();
    });
    return unsub;
  }, []);

  // Digression recovery: when a follow-up arrives while the user is diverted,
  // clear the diverted flag so the UI returns to normal watching state.
  useEffect(() => {
    const unsub = useSession.subscribe((state, prev) => {
      if (state.pendingFollowUp === prev.pendingFollowUp) return;
      if (!state.pendingFollowUp) return;
      if (!state.diverted) return;
      useSession.getState().setDiverted(false);
    });
    return unsub;
  }, []);

  // Quiet period trigger: wait for TS_QUIET_PERIOD_MS of silence after user
  // activity, then fire a tick. Disabled in training and teacher modes
  // (cfg.quietPeriodMs=0) and while the user is off on a digression — the
  // backstop timer covers re-checking until they return to the task.
  useQuietPeriod(TS_QUIET_PERIOD_MS, () => {
    const s = useSession.getState();
    if (s.status !== "watching") return;
    if (s.diverted) return;
    // Don't fire a tick while TTS is actively playing — it would cancel the audio.
    if (isSpeaking()) return;
    const cfg = getModeConfig(s.mode);
    if (cfg.quietPeriodMs <= 0) return;
    void tickRef.current();
  });
}
