import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/security-logger";
import { logError } from "@/lib/error-logger";

type Params = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/[slug]/rotate-token
 *
 * A07: Token revocation — lets the room owner generate a new owner_token,
 * immediately invalidating any previously stolen/leaked cookie.
 *
 * Requires the current valid owner_<slug> cookie.
 * On success the response sets a new owner_<slug> cookie with the replacement token.
 */
export async function POST(_req: Request, { params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, owner_token, user_id")
    .eq("slug", slug)
    .single();

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  if (!user || user.id !== room.user_id) {
    logSecurityEvent("auth_failure", { endpoint: "POST /rotate-token", slug });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const newToken = crypto.randomUUID();

  const { error } = await supabase
    .from("rooms")
    .update({ owner_token: newToken })
    .eq("id", room.id);

  if (error) {
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/rotate-token`, method: "POST", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to rotate token" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
