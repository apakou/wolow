import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/security-logger";
import { safeCompare } from "@/lib/safe-compare";
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
  const { data: room } = await supabase
    .from("rooms")
    .select("id, owner_token")
    .eq("slug", slug)
    .single();

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;

  if (!ownerToken || !safeCompare(ownerToken, room.owner_token)) {
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

  const res = NextResponse.json({ ok: true });
  res.cookies.set(`owner_${slug}`, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
