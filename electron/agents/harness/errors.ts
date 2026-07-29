// Errors the harness raises. Re-exported from ../../claude.ts so existing
// importers (main.ts) are unaffected.

export class MissingApiKeyError extends Error {
  constructor() {
    super("Anthropic API key is not configured");
    this.name = "MissingApiKeyError";
  }
}

export class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Rate limited; retry after ${retryAfterSec}s`);
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** Translate an SDK error into a RateLimitError when it is one. */
export function asRateLimit(err: unknown): RateLimitError | null {
  const anyErr = err as { status?: number; headers?: Record<string, string> };
  if (!anyErr || anyErr.status !== 429) return null;
  const retryAfter = Number(
    anyErr.headers?.["retry-after"] ?? anyErr.headers?.["Retry-After"] ?? 30,
  );
  return new RateLimitError(Number.isFinite(retryAfter) ? retryAfter : 30);
}
