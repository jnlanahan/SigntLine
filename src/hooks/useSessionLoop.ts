import { useCallback, useEffect, useRef } from "react";
import { useSession } from "../store/session";
import { useSettings } from "../store/settings";
import { api } from "../lib/api";

const RETRY_DELAY_MS = 10_000;

/**
 * Drives the capture → Claude → display loop. The loop owns its own timer so
 * cleanup happens deterministically when status changes away from "watching".
 */
export function useSessionLoop(onNeedsApiKey: () => void) {
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const tickRef = useRef<() => Promise<void>>(async () => {});

  const settings = useSettings((s) => s.settings);

  const tick = useCallback(async () => {
    if (inFlightRef.current) return;
    const state = useSession.getState();
    if (state.status !== "watching") return;
    if (!state.goal) return;

    const now = Date.now();
    if (state.rateLimitUntil && now < state.rateLimitUntil) return;

    inFlightRef.current = true;
    try {
      // 1. Capture
      const displayId = useSettings.getState().settings?.selectedDisplayId ?? null;
      let frame;
      try {
        frame = await api().capture.once(displayId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useSession.getState().setError(
          `Screen capture failed: ${msg}. Check Windows screen-recording permission.`,
        );
        useSession.getState().setStatus("error");
        return;
      }
      useSession.getState().pushFrame(frame);

      // 2. Ask Claude
      useSession.getState().setStatus("thinking");
      const s = useSession.getState();
      const result = await api().claude.nextInstruction({
        goal: s.goal!,
        completedSteps: s.completedSteps,
        conversation: s.conversation,
        frames: s.frames,
      });

      // Handle main-process error envelope.
      if (result && typeof result === "object" && "__error" in result) {
        const err = result as {
          __error: string;
          retryAfterSec?: number;
          message?: string;
        };
        if (err.__error === "missing_api_key") {
          useSession.getState().setStatus("paused");
          useSession.getState().setError(
            "Anthropic API key is not configured.",
          );
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
        // Pause for retry delay
        useSession.getState().setRateLimit(Date.now() + RETRY_DELAY_MS);
        return;
      }

      // 3. Display + update history
      useSession.getState().setError(null);
      useSession.getState().setRateLimit(null);
      useSession.getState().setInstruction(result.instruction);
      useSession.getState().setCompletedSteps(result.completedSteps);
      useSession.getState().setDone(result.done);
      useSession.getState().appendTurn({
        role: "assistant",
        content: result.instruction,
        timestamp: Date.now(),
      });

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

  // Keep the latest tick callable from inside setInterval without restarting it.
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Manage interval based on capture interval setting + status.
  useEffect(() => {
    const status = useSession.getState().status;
    function start() {
      if (timerRef.current !== null) return;
      const intervalSec = settings?.captureIntervalSec ?? 5;
      // Kick once immediately so the user gets fast feedback.
      void tickRef.current();
      timerRef.current = window.setInterval(
        () => void tickRef.current(),
        Math.max(1, intervalSec) * 1000,
      );
    }
    function stop() {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    if (status === "watching") {
      start();
    } else {
      stop();
    }

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
}
