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

const RETRY_DELAY_MS = 10_000;
// Minimum time we'll wait after an instruction before re-evaluating the
// screen — gives the user room to actually do the thing.
const POST_INSTRUCTION_COOLDOWN_MS = 2000;
// How long after an instruction before we speak the first waiting nudge.
const WAITING_NUDGE_DELAY_MS = 15_000;
// How often we repeat nudges while the user is idle.
const NUDGE_REPEAT_INTERVAL_MS = 30_000;

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

      if (!screenChanged && !hasPendingFollowUp) {
        // Nothing to act on — stay in watching state and keep polling.
        return;
      }

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
        goal: s.goal!,
        completedSteps: s.completedSteps,
        conversation: s.conversation,
        frames: s.frames,
        followUp,
        clarificationContext: s.clarificationContext,
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

        const ttsEnabled = useSettings.getState().settings?.ttsEnabled;
        if (ttsEnabled) {
          if (result.done) {
            // Always speak completion phrase — not sent via early event.
            speakRef.current(
              `${result.instruction} ${randomCompletionPhrase()}`,
            );
          } else if (!earlySpoken) {
            // Only speak if the early stream event didn't already trigger TTS.
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
          Date.now() + POST_INSTRUCTION_COOLDOWN_MS,
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

  // Main capture interval — active only when status === "watching".
  useEffect(() => {
    function start() {
      if (timerRef.current !== null) return;
      const intervalSec = settings?.captureIntervalSec ?? 15;
      void tickRef.current();
      timerRef.current = window.setInterval(
        () => void tickRef.current(),
        Math.max(2, intervalSec) * 1000,
      );
    }
    function stop() {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    if (useSession.getState().status === "watching") start();
    else stop();

    const unsub = useSession.subscribe((state, prev) => {
      if (state.status === prev.status) return;
      if (state.status === "watching") start();
      else stop();
    });

    return () => {
      unsub();
      stop();
    };
  }, [settings?.captureIntervalSec]);

  // Waiting nudge: after WAITING_NUDGE_DELAY_MS of no new instruction, speak
  // a gentle phrase. Repeats every NUDGE_REPEAT_INTERVAL_MS so the user
  // knows SightLine is still present.
  useEffect(() => {
    let lastNudgeAt: number | null = null;

    nudgeTimerRef.current = window.setInterval(() => {
      const s = useSession.getState();
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
      if (elapsed < WAITING_NUDGE_DELAY_MS) return;

      // Reset nudge tracking when a new instruction has come in.
      if (lastNudgeAt !== null && lastNudgeAt < s.lastInstructionAt) {
        lastNudgeAt = null;
      }

      // Don't nudge more often than NUDGE_REPEAT_INTERVAL_MS.
      if (lastNudgeAt !== null && Date.now() - lastNudgeAt < NUDGE_REPEAT_INTERVAL_MS)
        return;

      lastNudgeAt = Date.now();
      speakRef.current(randomWaitingPhrase());
    }, 4000);

    return () => {
      if (nudgeTimerRef.current !== null) {
        window.clearInterval(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }
    };
  }, []);
}
