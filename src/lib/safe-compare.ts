import { timingSafeEqual } from "crypto";

/**
 * A07: Timing-safe string comparison to prevent timing attacks on token validation.
 * Returns false immediately if either value is missing so callers can short-circuit.
 */
export function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
