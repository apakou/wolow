import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeCompare } from "@/lib/safe-compare";
import { logError } from "@/lib/error-logger";

type Params = { params: Promise<{ slug: string }> };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token, owner_public_key")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

/**
 * GET /api/rooms/[slug]/keys?conversation_id=...
 *
 * Returns both the owner's and visitor's public keys for a conversation.
 * No auth required — public keys are public by definition.
 */
export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");

  let visitorPublicKey = null;
  if (conversationId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("conversations")
      .select("visitor_public_key")
      .eq("id", conversationId)
      .eq("room_id", room.id)
      .single();
    visitorPublicKey = data?.visitor_public_key ?? null;
  }

  return NextResponse.json({
    owner_public_key: room.owner_public_key ?? null,
    visitor_public_key: visitorPublicKey,
  });
}

/**
 * PUT /api/rooms/[slug]/keys
 *
 * Sets the owner's public key. Requires the owner cookie.
 * Only sets the key if it hasn't been set yet (cannot overwrite).
 */
export async function PUT(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  if (!ownerToken || !safeCompare(ownerToken, room.owner_token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (room.owner_public_key) {
    return NextResponse.json({ ok: true, message: "Key already set" });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const publicKey = (body as Record<string, unknown>).public_key;
  if (!publicKey || typeof publicKey !== "object") {
    return NextResponse.json({ error: "public_key is required" }, { status: 422 });
  }

  const supabase = await createClient();
  const { data: success, error } = await supabase.rpc("set_owner_public_key", {
    p_room_id: room.id,
    p_owner_token: ownerToken,
    p_public_key: publicKey,
  });

  if (error) {
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/keys`, method: "PUT", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to store key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
