import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/security-logger";

type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

/**
 * A04: Database-backed rate limiter — shared state across all serverless instances.
 *
 * Uses the `check_and_increment_rate_limit` PostgreSQL function which performs
 * an atomic INSERT … ON CONFLICT, eliminating race conditions.
 *
 * Falls open on DB errors so an infrastructure failure never blocks real users.
 * Callers should pair this with the in-memory limiter as a first line of defence.
 */
export async function checkRateLimitDb(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("check_and_increment_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });

    if (error || !data || (data as unknown[]).length === 0) {
      // Fail open: don't block users due to infra failure, but log for monitoring
      logSecurityEvent("rate_limit_hit", { endpoint: "db-rate-limit", ip: key, retryAfter: 0 });
      return { ok: true };
    }

    const row = (data as { allowed: boolean; current_count: number; retry_after_ms: number }[])[0];
    if (!row.allowed) {
      return { ok: false, retryAfter: Math.ceil(row.retry_after_ms / 1000) };
    }
    return { ok: true };
  } catch {
    // Fail open on unexpected errors, but log for monitoring
    logSecurityEvent("rate_limit_hit", { endpoint: "db-rate-limit-error", ip: key, retryAfter: 0 });
    return { ok: true };
  }
}
