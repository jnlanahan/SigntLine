import { useCallback, useEffect, useRef } from "react";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";
import { hashFrame, hashesAreSimilar } from "../lib/frameHash";
import { useTts, randomWaitingPhrase, randomScreenChangePhrase } from "./useTts";

const RETRY_DELAY_MS = 10_000;
const IDLE_CYCLE_THRESHOLD = 3;

export function useSessionLoop(onNeedsApiKey: () => void, focused: boolean) {
  const timerRef = useRef<number | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const tickRef = useRef<() => Promise<void>>(async () => {});
  const focusedRef = useRef(focused);

  const settings = useSettings((s) => s.settings);
  const { speak, cancel: cancelTts } = useTts();
  const speakRef = useRef(speak);
  const cancelTtsRef = useRef(cancelTts);

  useEffect(() => { focusedRef.current = focused; }, [focused]);
  useEffect(() => { speakRef.current = speak; }, [speak]);
  useEffect(() => { cancelTtsRef.current = cancelTts; }, [cancelTts]);

  const tick = useCallback(async () => {
    if (inFlightRef.current) return;
    const state = useSession.getState();
    if (state.status !== "watching") return;
    if (!state.goal) return;

    const now = Date.now();
    if (state.rateLimitUntil && now < state.rateLimitUntil) return;

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

      // 2. Screen-change detection
      const newHash = await hashFrame(frame.dataUrl);
      const lastHash = useSession.getState().lastProcessedHash;
      const screenChanged = !hashesAreSimilar(newHash, lastHash ?? "");
      const hasPendingFollowUp = Boolean(useSession.getState().pendingFollowUp);

      if (!screenChanged && !hasPendingFollowUp) {
        // Nothing new — skip Claude call
        useSession.getState().incrementIdleCycles();
        const idleCycles = useSession.getState().idleCycles;
        if (idleCycles >= IDLE_CYCLE_THRESHOLD && !focusedRef.current) {
          useSession.getState().setStatus("paused");
          useSession.getState().setPauseReason("idle");
        }
        return;
      }

      useSession.getState().resetIdleCycles();

      // 3. Ask Claude
      cancelTtsRef.current();
      useSession.getState().setStatus("thinking");
      const s = useSession.getState();

      // Consume pending follow-up
      const followUp = s.pendingFollowUp ?? undefined;
      if (s.pendingFollowUp) {
        useSession.getState().setPendingFollowUp(null);
      }

      const result = await api().claude.nextInstruction({
        goal: s.goal!,
        completedSteps: s.completedSteps,
        conversation: s.conversation,
        frames: s.frames,
        followUp,
        clarificationContext: s.clarificationContext,
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

      // 4. Update state
      useSession.getState().setError(null);
      useSession.getState().setRateLimit(null);
      useSession.getState().setInstruction(result.instruction);
      useSession.getState().setCompletedSteps(result.completedSteps);
      useSession.getState().setDone(result.done);
      useSession.getState().setLastProcessedHash(newHash);
      useSession.getState().appendTurn({
        role: "assistant",
        content: result.instruction,
        timestamp: Date.now(),
      });

      // TTS: speak instruction then queue a patient waiting phrase
      if (useSettings.getState().settings?.ttsEnabled && !result.done) {
        speakRef.current(result.instruction, randomWaitingPhrase());
      } else if (useSettings.getState().settings?.ttsEnabled) {
        speakRef.current(result.instruction);
      }

      // Research signal
      if (result.needsResearch && result.researchQuery) {
        useSession.getState().setResearchQuery(result.researchQuery);
        useSession.getState().setStatus("researching");
        useSession.getState().setPauseReason("user");
        void api().window.openExternal(
          `https://www.google.com/search?q=${encodeURIComponent(result.researchQuery)}`,
        );
        return;
      }

      if (result.done) {
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
      inFlightRef.current = false;
    }
  }, [onNeedsApiKey]);

  useEffect(() => { tickRef.current = tick; }, [tick]);

  // Main capture interval — active only when status === "watching"
  useEffect(() => {
    function start() {
      if (timerRef.current !== null) return;
      const intervalSec = settings?.captureIntervalSec ?? 15;
      void tickRef.current();
      timerRef.current = window.setInterval(
        () => void tickRef.current(),
        Math.max(5, intervalSec) * 1000,
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

    return () => { unsub(); stop(); };
  }, [settings?.captureIntervalSec]);

  // Peek interval — fires during idle auto-pause, auto-resumes when screen changes
  useEffect(() => {
    function startPeek() {
      if (peekTimerRef.current !== null) return;
      const intervalSec = settings?.captureIntervalSec ?? 15;
      peekTimerRef.current = window.setInterval(async () => {
        const s = useSession.getState();
        if (s.status !== "paused" || s.pauseReason !== "idle") {
          stopPeek();
          return;
        }
        const displayId = useSettings.getState().settings?.selectedDisplayId ?? null;
        try {
          const frame = await api().capture.once(displayId);
          const newHash = await hashFrame(frame.dataUrl);
          if (!hashesAreSimilar(newHash, s.lastProcessedHash ?? "")) {
            // Screen changed — speak feedback then resume
            if (useSettings.getState().settings?.ttsEnabled) {
              speakRef.current(randomScreenChangePhrase());
            }
            useSession.getState().setPauseReason(null);
            useSession.getState().resetIdleCycles();
            useSession.getState().setStatus("watching");
          }
        } catch {
          // ignore capture errors during peek
        }
      }, Math.max(10, (settings?.captureIntervalSec ?? 15) * 2) * 1000);
    }
    function stopPeek() {
      if (peekTimerRef.current !== null) {
        window.clearInterval(peekTimerRef.current);
        peekTimerRef.current = null;
      }
    }

    const unsub = useSession.subscribe((state, prev) => {
      if (state.status === prev.status && state.pauseReason === prev.pauseReason) return;
      if (state.status === "paused" && state.pauseReason === "idle") startPeek();
      else stopPeek();
    });

    return () => { unsub(); stopPeek(); };
  }, [settings?.captureIntervalSec]);
}
