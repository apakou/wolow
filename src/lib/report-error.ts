"use client";

type ClientErrorInput = {
  message: string;
  stack?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  slug?: string;
  metadata?: Record<string, unknown>;
  level?: "error" | "warn" | "info";
};

// Simple dedup: don't report the exact same message more than once per 10s
const recentlyReported = new Map<string, number>();
const DEDUP_WINDOW_MS = 10_000;

/**
 * Report a client-side error to the backend for persistence.
 * Non-blocking, fire-and-forget. Silently swallows its own errors.
 */
export function reportError(input: ClientErrorInput): void {
  try {
    const key = input.message;
    const now = Date.now();
    const last = recentlyReported.get(key);
    if (last && now - last < DEDUP_WINDOW_MS) return;
    recentlyReported.set(key, now);

    // Prune old entries to avoid unbounded growth
    if (recentlyReported.size > 200) {
      for (const [k, ts] of recentlyReported) {
        if (now - ts > DEDUP_WINDOW_MS) recentlyReported.delete(k);
      }
    }

    const body = JSON.stringify({
      source: "client",
      level: input.level ?? "error",
      message: input.message,
      stack: input.stack,
      endpoint: input.endpoint,
      method: input.method,
      status_code: input.statusCode,
      slug: input.slug,
      metadata: input.metadata,
    });

    // Use sendBeacon if available (works during page unload), else fetch
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/error-logs",
        new Blob([body], { type: "application/json" })
      );
    } else {
      void fetch("/api/error-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Never let the reporter itself throw
  }
}

/**
 * Convenience: wrap an Error object into a report.
 */
export function reportErrorObject(
  err: unknown,
  context?: Omit<ClientErrorInput, "message" | "stack">
): void {
  if (err instanceof Error) {
    reportError({
      message: err.message,
      stack: err.stack,
      ...context,
    });
  } else {
    reportError({
      message: String(err),
      ...context,
    });
  }
}
