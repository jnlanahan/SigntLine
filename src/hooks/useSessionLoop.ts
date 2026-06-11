import { useCallback, useEffect, useRef } from "react";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { hashFrame, hashesAreSimilar } from "../lib/frameHash";
import {
  useTts,
  randomWaitingPhrase,
  randomCompletionPhrase,
  waitForSpeechEnd,
  isSpeaking,
} from "./useTts";
import { useQuietPeriod } from "./useQuietPeriod";
import type { AppMode } from "../lib/api";

const RETRY_DELAY_MS = 10_000;

// Timing constants that only apply in tech_support mode.
const TS_POST_INSTRUCTION_COOLDOWN_MS = 5000;
const TS_WAITING_NUDGE_DELAY_MS = 30_000;
const TS_NUDGE_REPEAT_INTERVAL_MS = 60_000;
const TS_QUIET_PERIOD_MS = 3_500; // silence before triggering a check
const TS_IDLE_INTERVAL_MS = 30_000;
const TS_IDLE_TICK_THRESHOLD = 3;

// Timing for training mode — slow, non-interrupting.
const TRAIN_POST_INSTRUCTION_COOLDOWN_MS = 10_000;
const TRAIN_NORMAL_INTERVAL_MS = 60_000;
const TRAIN_IDLE_INTERVAL_MS = 90_000;

type ModeConfig = {
  // How long to wait before the first re-poll after an instruction.
  postCooldownMs: number;
  // Fallback auto-poll interval (ms). 0 = no auto-poll (teacher mode).
  normalIntervalMs: number;
  idleIntervalMs: number;
  idleTickThreshold: number;
  // Whether to play "I'm still watching" nudges.
  nudgeEnabled: boolean;
  // ms of silence after last input before triggering a check. 0 = disabled.
  quietPeriodMs: number;
  // If true, skip the tick unless screen changed or there's a pending follow-up.
  // If false (teacher), ONLY fire when there's a pending follow-up.
  requireScreenChange: boolean;
};

function getModeConfig(mode: AppMode | null, _captureIntervalSec: number): ModeConfig {
  switch (mode) {
    case "training":
      return {
        postCooldownMs: TRAIN_POST_INSTRUCTION_COOLDOWN_MS,
        normalIntervalMs: TRAIN_NORMAL_INTERVAL_MS,
        idleIntervalMs: TRAIN_IDLE_INTERVAL_MS,
        idleTickThreshold: 999, // effectively disable idle tier
        nudgeEnabled: false,
        quietPeriodMs: 0, // no input trigger in training
        requireScreenChange: true,
      };
    case "teacher":
      return {
        postCooldownMs: 2000,
        normalIntervalMs: 0, // no auto-poll — conversation-driven only
        idleIntervalMs: 0,
        idleTickThreshold: 999,
        nudgeEnabled: false,
        quietPeriodMs: 0, // conversation-driven, not input-triggered
        requireScreenChange: false,
      };
    default: // tech_support
      return {
        postCooldownMs: TS_POST_INSTRUCTION_COOLDOWN_MS,
        normalIntervalMs: 30_000, // fallback — quiet period handles responsive triggering
        idleIntervalMs: TS_IDLE_INTERVAL_MS,
        idleTickThreshold: TS_IDLE_TICK_THRESHOLD,
        nudgeEnabled: true,
        quietPeriodMs: TS_QUIET_PERIOD_MS,
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
  const nudgeTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const tickRef = useRef<() => Promise<void>>(async () => {});
  const focusedRef = useRef(focused);

  const settings = useSettings((s) => s.settings);
  const { speak } = useTts();
  const speakRef = useRef(speak);

  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  const tick = useCallback(async () => {
    if (inFlightRef.current) return;
    const state = useSession.getState();
    if (state.status !== "watching") return;
    if (!state.goal) return;

    const now = Date.now();
    if (state.rateLimitUntil && now < state.rateLimitUntil) return;
    if (state.cooldownUntil && now < state.cooldownUntil) return;

    const cfg = getModeConfig(
      state.mode,
      useSettings.getState().settings?.captureIntervalSec ?? 15,
    );

    // Teacher mode: only fire when the user has sent a follow-up message.
    if (!cfg.requireScreenChange && !state.pendingFollowUp) return;

    inFlightRef.current = true;
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

      // 2. Screen-change detection — skip the API call when nothing meaningful
      //    has happened (cursor jitter, blinking caret, etc).
      const newHash = await hashFrame(frame.dataUrl);
      const lastHash = useSession.getState().lastProcessedHash;
      const screenChanged = !hashesAreSimilar(newHash, lastHash ?? "");
      const hasPendingFollowUp = Boolean(useSession.getState().pendingFollowUp);

      if (cfg.requireScreenChange && !screenChanged && !hasPendingFollowUp) {
        useSession.getState().incrementIdleCycles();
        return;
      }
      useSession.getState().resetIdleCycles();

      // 3. Ask Claude. We deliberately do NOT cancel any in-flight TTS here
      //    — the peek phrase should keep playing while Claude thinks.
      useSession.getState().setStatus("thinking");
      const s = useSession.getState();

      // Consume pending follow-up
      const followUp = s.pendingFollowUp ?? undefined;
      if (s.pendingFollowUp) {
        useSession.getState().setPendingFollowUp(null);
      }

      // Subscribe to early instruction event — fires as soon as the instruction
      // field is complete in the Claude stream, before the full JSON arrives.
      let earlySpoken = false;
      const unsubEarly = api().claude.onInstructionReady((earlyText) => {
        const ttsOn = useSettings.getState().settings?.ttsEnabled;
        if (ttsOn) {
          speakRef.current(earlyText);
          earlySpoken = true;
        }
      });

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
      });
      unsubEarly();

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

      // 4. Update state
      useSession.getState().setError(null);
      useSession.getState().setRateLimit(null);

      if (result.notes && result.notes.trim().length > 0) {
        useSession.getState().appendAgentNote(result.notes.trim());
      }

      // Digression: user navigated away from the task. Speak a warm pause
      // message and stop the loop — it resumes when the user sends a follow-up.
      if (result.digression) {
        useSession.getState().setDiverted(true);
        useSession.getState().setLastProcessedHash(newHash);
        useSession.getState().setInstruction(result.instruction);
        useSession.getState().appendTurn({
          role: "assistant",
          content: result.instruction,
          timestamp: Date.now(),
        });
        useSession.getState().setLastSpokenInstruction(result.instruction);
        const ttsEnabled = useSettings.getState().settings?.ttsEnabled;
        if (ttsEnabled && !earlySpoken) speakRef.current(result.instruction);
        useSession.getState().setStatus("waiting");
        return;
      }

      const lastSpoken = useSession.getState().lastSpokenInstruction;
      const isRepeat =
        result.instruction &&
        instructionsAreSimilar(result.instruction, lastSpoken ?? "");

      useSession.getState().setCompletedSteps(result.completedSteps);
      useSession.getState().setUpcomingSteps(result.upcomingSteps ?? []);
      useSession.getState().setDone(result.done);
      useSession.getState().setLastProcessedHash(newHash);

      if (!isRepeat) {
        useSession.getState().setInstruction(result.instruction);
        useSession.getState().appendTurn({
          role: "assistant",
          content: result.instruction,
          timestamp: Date.now(),
        });
        useSession.getState().setLastSpokenInstruction(result.instruction);
        useSession.getState().setLastInstructionAt(Date.now());

        useSession.getState().resetIdleCycles();

        const ttsEnabled = useSettings.getState().settings?.ttsEnabled;
        if (ttsEnabled) {
          if (result.done) {
            speakRef.current(
              `${result.instruction} ${randomCompletionPhrase()}`,
            );
          } else if (!earlySpoken) {
            speakRef.current(result.instruction);
          }
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

      if (result.done) {
        useSession.getState().setStatus("waiting");
      } else {
        useSession.getState().setStatus("watching");
        useSession.getState().setCooldownUntil(
          Date.now() + cfg.postCooldownMs,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useSession.getState().setError(msg);
      useSession.getState().setStatus("watching");
      useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
    } finally {
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

      await tickRef.current();

      // Wait for any TTS audio to finish before scheduling the next tick.
      // Prevents the next instruction from firing while the current one is still speaking.
      await waitForSpeechEnd();

      if (cancelled) return;

      const s = useSession.getState();
      const cfg = getModeConfig(
        s.mode,
        useSettings.getState().settings?.captureIntervalSec ?? 15,
      );

      // Teacher mode has no auto-poll — loop exits here and restarts only
      // when a follow-up is submitted (see the pendingFollowUp watcher below).
      if (cfg.normalIntervalMs === 0) return;

      const delayMs =
        s.idleCycles >= cfg.idleTickThreshold
          ? cfg.idleIntervalMs
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

  // Teacher mode: restart the loop whenever a follow-up is submitted. Since
  // the scheduled loop exits immediately (normalIntervalMs = 0), this is the
  // only trigger for teacher-mode ticks.
  useEffect(() => {
    const unsub = useSession.subscribe((state, prev) => {
      if (state.pendingFollowUp === prev.pendingFollowUp) return;
      if (!state.pendingFollowUp) return;
      if (state.mode !== "teacher") return;
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

  // Waiting nudge: tech_support only. After WAITING_NUDGE_DELAY_MS of no new
  // instruction, speak a gentle phrase so the user knows we're still watching.
  useEffect(() => {
    let lastNudgeAt: number | null = null;

    nudgeTimerRef.current = window.setInterval(() => {
      const s = useSession.getState();
      const cfg = getModeConfig(
        s.mode,
        useSettings.getState().settings?.captureIntervalSec ?? 15,
      );
      if (!cfg.nudgeEnabled) return;

      const ttsEnabled = useSettings.getState().settings?.ttsEnabled;
      if (!ttsEnabled) return;
      if (!s.lastInstructionAt) return;
      if (
        s.status === "thinking" ||
        s.status === "error" ||
        s.status === "waiting" ||
        s.status === "paused"
      )
        return;

      const elapsed = Date.now() - s.lastInstructionAt;
      if (elapsed < TS_WAITING_NUDGE_DELAY_MS) return;

      if (lastNudgeAt !== null && lastNudgeAt < s.lastInstructionAt) {
        lastNudgeAt = null;
      }

      if (lastNudgeAt !== null && Date.now() - lastNudgeAt < TS_NUDGE_REPEAT_INTERVAL_MS)
        return;

      // Don't nudge while something is still being spoken.
      if (isSpeaking()) return;

      lastNudgeAt = Date.now();
      speakRef.current(randomWaitingPhrase());

      useSession.getState().setLastProcessedHash(null);
      void tickRef.current();
    }, 4000);

    return () => {
      if (nudgeTimerRef.current !== null) {
        window.clearInterval(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }
    };
  }, []);

  // Quiet period trigger: wait for TS_QUIET_PERIOD_MS of silence after user
  // activity, then fire a tick. Disabled in training and teacher modes (cfg.quietPeriodMs=0).
  useQuietPeriod(TS_QUIET_PERIOD_MS, () => {
    const s = useSession.getState();
    if (s.status !== "watching") return;
    // Don't fire a tick while TTS is actively playing — it would cancel the audio.
    if (isSpeaking()) return;
    const cfg = getModeConfig(
      s.mode,
      useSettings.getState().settings?.captureIntervalSec ?? 15,
    );
    if (cfg.quietPeriodMs <= 0) return;
    void tickRef.current();
  });
}
