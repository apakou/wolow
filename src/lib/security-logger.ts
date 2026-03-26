/**
 * Security event logger — writes structured events to stderr so they appear
 * in Vercel function logs, Supabase edge logs, and any log aggregator.
 * Never include user content or PII — only identifiers needed for auditing.
 */

type SecurityEvent =
  | "rate_limit_hit"
  | "unauthorized_access"
  | "auth_failure"
  | "invalid_input"
  | "cross_resource_access";

export function logSecurityEvent(
  event: SecurityEvent,
  context: Record<string, string | boolean | number | null>
): void {
  const entry = {
    level: "security",
    event,
    ts: new Date().toISOString(),
    ...context,
  };
  // Use console.warn so it surfaces in server logs without polluting stdout.
  // Vercel captures both stdout and stderr from serverless functions.
  console.warn("[SECURITY]", JSON.stringify(entry));
}
