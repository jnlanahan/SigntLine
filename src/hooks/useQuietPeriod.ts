import { useEffect, useRef } from "react";
import { api } from "../lib/api";

// Pure timer logic — no React, no API. Exported for unit tests.
// Fires onQuiet exactly once after delayMs of silence (no onActivity calls).
export function createQuietPeriodTimer(delayMs: number, onQuiet: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function onActivity() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onQuiet();
    }, delayMs);
  }

  function cleanup() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { onActivity, cleanup };
}

// Subscribes to input.onActivity and fires onQuiet after delayMs of silence.
// Pass delayMs <= 0 to disable (no subscription created).
export function useQuietPeriod(delayMs: number, onQuiet: () => void) {
  const onQuietRef = useRef(onQuiet);
  useEffect(() => {
    onQuietRef.current = onQuiet;
  }, [onQuiet]);

  useEffect(() => {
    if (delayMs <= 0) return;
    const { onActivity, cleanup } = createQuietPeriodTimer(delayMs, () =>
      onQuietRef.current(),
    );
    const unsub = api().input.onActivity(onActivity);
    return () => {
      unsub();
      cleanup();
    };
  }, [delayMs]);
}
