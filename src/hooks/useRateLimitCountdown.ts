import { useEffect, useState } from "react";
import { useSession } from "../store/session";

export function useRateLimitCountdown(): number | null {
  const rateLimitUntil = useSession((s) => s.rateLimitUntil);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!rateLimitUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [rateLimitUntil]);

  if (!rateLimitUntil) return null;
  const remaining = Math.max(0, Math.ceil((rateLimitUntil - now) / 1000));
  return remaining;
}
