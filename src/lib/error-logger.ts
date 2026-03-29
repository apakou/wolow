import { createClient } from "@/lib/supabase/server";

type ErrorLogInput = {
  message: string;
  stack?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  slug?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  level?: "error" | "warn" | "info";
};

/**
 * Log an error to the error_logs table from server-side code.
 * Fire-and-forget — never throws and never blocks the caller.
 */
export function logError(input: ErrorLogInput): void {
  // Run async but don't await — we don't want error logging to slow responses
  void (async () => {
    try {
      const supabase = await createClient();
      await supabase.rpc("insert_error_log", {
        p_source: "server",
        p_level: input.level ?? "error",
        p_message: input.message,
        p_stack: input.stack ?? null,
        p_endpoint: input.endpoint ?? null,
        p_method: input.method ?? null,
        p_status_code: input.statusCode ?? null,
        p_slug: input.slug ?? null,
        p_user_agent: input.userAgent ?? null,
        p_ip: input.ip ?? null,
        p_metadata: input.metadata ?? {},
      });
    } catch {
      // Logging itself must never fail the request — swallow silently.
      // The console.error below is the last-resort breadcrumb.
      console.error("[error-logger] Failed to persist error log");
    }
  })();
}
