import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/error-logs
 *
 * Receives error reports from the client and persists them via the
 * insert_error_log RPC. Rate limiting is intentionally light here —
 * we'd rather capture errors than miss them.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  const message = typeof b.message === "string" ? b.message : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 422 });
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const supabase = await createClient();
  const { error } = await supabase.rpc("insert_error_log", {
    p_source: typeof b.source === "string" ? b.source : "client",
    p_level: typeof b.level === "string" ? b.level : "error",
    p_message: message,
    p_stack: typeof b.stack === "string" ? b.stack : null,
    p_endpoint: typeof b.endpoint === "string" ? b.endpoint : null,
    p_method: typeof b.method === "string" ? b.method : null,
    p_status_code: typeof b.status_code === "number" ? b.status_code : null,
    p_slug: typeof b.slug === "string" ? b.slug : null,
    p_user_agent: userAgent ?? null,
    p_ip: ip,
    p_metadata: typeof b.metadata === "object" && b.metadata ? b.metadata : {},
  });

  if (error) {
    // Don't fail the user response, but log server-side for ops visibility
    console.error("[error-logs] Failed to persist:", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
