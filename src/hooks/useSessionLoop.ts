import { useCallback, useEffect, useRef } from "react";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { hashFrame, hashesAreSimilar } from "../lib/frameHash";
import {
  useTts,
  randomWaitingPhrase,
  randomCompletionPhrase,
} from "./useTts";
import type { AppMode } from "../lib/api";

const RETRY_DELAY_MS = 10_000;

// Timing constants that only apply in tech_support mode.
const TS_POST_INSTRUCTION_COOLDOWN_MS = 2000;
const TS_WAITING_NUDGE_DELAY_MS = 15_000;
const TS_NUDGE_REPEAT_INTERVAL_MS = 30_000;
const TS_ALERT_INTERVAL_MS = 2_000;
const TS_ALERT_WINDOW_MS = 20_000;
const TS_IDLE_INTERVAL_MS = 30_000;
const TS_IDLE_TICK_THRESHOLD = 3;

// Timing for training mode — slow, non-interrupting.
const TRAIN_POST_INSTRUCTION_COOLDOWN_MS = 10_000;
const TRAIN_NORMAL_INTERVAL_MS = 60_000;
const TRAIN_IDLE_INTERVAL_MS = 90_000;

type ModeConfig = {
  // If > 0, enable a rapid-fire alert window after each instruction.
  alertWindowMs: number;
  alertIntervalMs: number;
  // How long to wait before the first re-poll after an instruction.
  postCooldownMs: number;
  // Auto-poll interval during normal operation (ms). 0 = no auto-poll.
  normalIntervalMs: number;
  idleIntervalMs: number;
  idleTickThreshold: number;
  // Whether to play "I'm still watching" nudges.
  nudgeEnabled: boolean;
  // Whether mouse/keyboard activity triggers an immediate tick.
  inputTriggeredEnabled: boolean;
  // If true, skip the tick unless screen changed or there's a pending follow-up.
  // If false (teacher), ONLY fire when there's a pending follow-up.
  requireScreenChange: boolean;
};

function getModeConfig(mode: AppMode | null, captureIntervalSec: number): ModeConfig {
  switch (mode) {
    case "training":
      return {
        alertWindowMs: 0,
        alertIntervalMs: 0,
        postCooldownMs: TRAIN_POST_INSTRUCTION_COOLDOWN_MS,
        normalIntervalMs: TRAIN_NORMAL_INTERVAL_MS,
        idleIntervalMs: TRAIN_IDLE_INTERVAL_MS,
        idleTickThreshold: 999, // effectively disable idle tier
        nudgeEnabled: false,
        inputTriggeredEnabled: false,
        requireScreenChange: true,
      };
    case "teacher":
      return {
        alertWindowMs: 0,
        alertIntervalMs: 0,
        postCooldownMs: 2000,
        normalIntervalMs: 0, // no auto-poll — conversation-driven only
        idleIntervalMs: 0,
        idleTickThreshold: 999,
        nudgeEnabled: false,
        inputTriggeredEnabled: false,
        requireScreenChange: false, // only fire on pendingFollowUp
      };
    default: // tech_support
      return {
        alertWindowMs: TS_ALERT_WINDOW_MS,
        alertIntervalMs: TS_ALERT_INTERVAL_MS,
        postCooldownMs: TS_POST_INSTRUCTION_COOLDOWN_MS,
        normalIntervalMs: Math.max(2, captureIntervalSec) * 1000,
        idleIntervalMs: TS_IDLE_INTERVAL_MS,
        idleTickThreshold: TS_IDLE_TICK_THRESHOLD,
        nudgeEnabled: true,
        inputTriggeredEnabled: true,
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

      const lastSpoken = useSession.getState().lastSpokenInstruction;
      const isRepeat =
        result.instruction &&
        instructionsAreSimilar(result.instruction, lastSpoken ?? "");

      useSession.getState().setCompletedSteps(result.completedSteps);
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

        // Alert window only in tech_support — other modes don't want rapid
        // re-polling right after Claude speaks.
        if (cfg.alertWindowMs > 0) {
          useSession.getState().setAfterInstructionAlertUntil(
            Date.now() + cfg.alertWindowMs,
          );
        }
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

      if (cancelled) return;

      const s = useSession.getState();
      const now = Date.now();
      const cfg = getModeConfig(
        s.mode,
        useSettings.getState().settings?.captureIntervalSec ?? 15,
      );

      // Teacher mode has no auto-poll — loop exits here and restarts only
      // when a follow-up is submitted (see the pendingFollowUp watcher below).
      if (cfg.normalIntervalMs === 0) return;

      let delayMs: number;
      if (
        cfg.alertWindowMs > 0 &&
        s.afterInstructionAlertUntil &&
        now < s.afterInstructionAlertUntil
      ) {
        delayMs = cfg.alertIntervalMs;
      } else if (s.idleCycles >= cfg.idleTickThreshold) {
        delayMs = cfg.idleIntervalMs;
      } else {
        delayMs = cfg.normalIntervalMs;
      }

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

  // Input-triggered check: fire an immediate tick on mouse/keyboard activity.
  // Suppressed in training (would interrupt demos) and teacher (conversation-driven).
  useEffect(() => {
    const unsub = api().input.onActivity(() => {
      const s = useSession.getState();
      if (s.status !== "watching") return;
      const cfg = getModeConfig(
        s.mode,
        useSettings.getState().settings?.captureIntervalSec ?? 15,
      );
      if (!cfg.inputTriggeredEnabled) return;
      if (
        cfg.alertWindowMs > 0 &&
        s.afterInstructionAlertUntil &&
        Date.now() < s.afterInstructionAlertUntil
      )
        return;
      void tickRef.current();
    });
    return unsub;
  }, []);
}
