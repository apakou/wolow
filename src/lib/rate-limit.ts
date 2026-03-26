type Window = { count: number; resetAt: number };

const store = new Map<string, Window>();

// Prune expired entries to prevent unbounded memory growth.
// Called opportunistically on each check — cheap at typical traffic.
function prune(now: number) {
  for (const [key, win] of store) {
    if (now >= win.resetAt) store.delete(key);
  }
}

/**
 * Check whether the given key is within the allowed rate.
 *
 * @param key       - Unique identifier (e.g. "create-room:1.2.3.4")
 * @param limit     - Max requests allowed in the window
 * @param windowMs  - Rolling window size in milliseconds
 * @returns `{ ok: true }` when allowed, or `{ ok: false, retryAfter }` when limited
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  prune(now);

  let win = store.get(key);

  if (!win || now >= win.resetAt) {
    win = { count: 1, resetAt: now + windowMs };
    store.set(key, win);
    return { ok: true };
  }

  if (win.count >= limit) {
    const retryAfter = Math.ceil((win.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }

  win.count += 1;
  return { ok: true };
}

/**
 * Extract the best available client IP from a Next.js Request.
 * Falls back to "unknown" when running locally without a proxy.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// Pre-configured limiters for each endpoint
export const LIMITS = {
  /** 5 room creations per IP per hour */
  createRoom: { limit: 5, windowMs: 60 * 60 * 1000 },
  /** 10 messages per IP per minute */
  sendMessage: { limit: 10, windowMs: 60 * 1000 },
} as const;
