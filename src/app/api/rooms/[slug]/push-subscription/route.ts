import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { safeCompare } from "@/lib/safe-compare";
import { logError } from "@/lib/error-logger";

type Params = { params: Promise<{ slug: string }> };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

/**
 * POST — Subscribe to push notifications.
 * Requires a valid owner_<slug> or sender_<slug> cookie.
 */
export async function POST(req: Request, { params }: Params) {
  const { slug } = await params;

  const ip = getClientIp(req);
  const rl = checkRateLimit(`push-subscribe:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  const endpoint = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
  const p256dh = typeof b.p256dh === "string" ? b.p256dh.trim() : "";
  const authKey = typeof b.auth_key === "string" ? b.auth_key.trim() : "";
  const conversationId =
    typeof b.conversation_id === "string" ? b.conversation_id.trim() : null;

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json(
      { error: "endpoint, p256dh, and auth_key are required" },
      { status: 422 }
    );
  }

  // Validate endpoint is a proper HTTPS URL
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") {
      return NextResponse.json({ error: "Endpoint must be HTTPS" }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid endpoint URL" }, { status: 422 });
  }

  // Determine role from cookies
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  const senderToken = cookieStore.get(`sender_${slug}`)?.value;

  let role: "owner" | "visitor";

  if (ownerToken && safeCompare(ownerToken, room.owner_token)) {
    role = "owner";
  } else if (senderToken) {
    role = "visitor";
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required for visitor subscriptions" },
        { status: 422 }
      );
    }
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Upsert — if this browser endpoint already exists, update the keys/role/room
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      room_id: room.id,
      conversation_id: role === "visitor" ? conversationId : null,
      role,
      endpoint,
      p256dh,
      auth_key: authKey,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    logError({
      message: error.message,
      endpoint: `/api/rooms/${slug}/push-subscription`,
      method: "POST",
      statusCode: 500,
      slug,
    });
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * DELETE — Unsubscribe from push notifications.
 */
export async function DELETE(req: Request, { params }: Params) {
  await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const endpoint =
    typeof (body as Record<string, unknown>).endpoint === "string"
      ? ((body as Record<string, unknown>).endpoint as string).trim()
      : "";

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 422 });
  }

  const supabase = await createClient();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
