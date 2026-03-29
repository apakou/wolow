import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/security-logger";
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

function parseBodyValue(body: unknown, key: string): string {
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function validateEmoji(raw: string): string | null {
  if (!raw) return null;
  // Cap at 16 bytes — covers ZWJ sequences, flag emojis, keycap sequences etc.
  if (raw.length > 16) return null;
  // A03: Reject strings that contain no actual emoji character (prevents arbitrary text/scripts)
  if (!/\p{Emoji}/u.test(raw)) return null;
  return raw;
}

async function resolveActor(slug: string, ownerTokenFromRoom: string) {
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  const senderToken = cookieStore.get(`sender_${slug}`)?.value;
  const isOwner = safeCompare(ownerToken, ownerTokenFromRoom);

  // Any owner can react; sender must have the sender cookie for this room.
  if (!isOwner && !senderToken) {
    return { ok: false as const };
  }

  return { ok: true as const, isOwner };
}

async function verifyMessageBelongsToRoom(messageId: string, roomId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("id", messageId)
    .eq("room_id", roomId)
    .single();
  return !!data;
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params;
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

  const messageId = parseBodyValue(body, "message_id");
  const emoji = validateEmoji(parseBodyValue(body, "emoji"));

  if (!messageId || !emoji) {
    return NextResponse.json({ error: "message_id and emoji are required" }, { status: 422 });
  }

  const actor = await resolveActor(slug, room.owner_token);
  if (!actor.ok) {
    logSecurityEvent("unauthorized_access", { endpoint: "POST /reactions", slug });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const belongsToRoom = await verifyMessageBelongsToRoom(messageId, room.id);
  if (!belongsToRoom) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("reactions")
    .upsert(
      { message_id: messageId, emoji, is_owner: actor.isOwner },
      { onConflict: "message_id,is_owner" }
    );

  if (error?.message?.includes("message_id,is_owner")) {
    const { error: clearError } = await supabase
      .from("reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("is_owner", actor.isOwner);

    if (clearError) {
      logError({ message: clearError.message, endpoint: `/api/rooms/${slug}/reactions`, method: "POST", statusCode: 500, slug });
      return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
    }

    const { error: insertError } = await supabase
      .from("reactions")
      .insert({ message_id: messageId, emoji, is_owner: actor.isOwner });

    if (insertError && insertError.code !== "23505") {
      logError({ message: insertError.message, endpoint: `/api/rooms/${slug}/reactions`, method: "POST", statusCode: 500, slug });
      return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  }

  // Duplicate insert is fine for idempotency.
  if (error && error.code !== "23505") {
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/reactions`, method: "POST", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request, { params }: Params) {
  const { slug } = await params;
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

  const messageId = parseBodyValue(body, "message_id");
  const emoji = validateEmoji(parseBodyValue(body, "emoji"));

  if (!messageId || !emoji) {
    return NextResponse.json({ error: "message_id and emoji are required" }, { status: 422 });
  }

  const actor = await resolveActor(slug, room.owner_token);
  if (!actor.ok) {
    logSecurityEvent("unauthorized_access", { endpoint: "DELETE /reactions", slug });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const belongsToRoom = await verifyMessageBelongsToRoom(messageId, room.id);
  if (!belongsToRoom) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("emoji", emoji)
    .eq("is_owner", actor.isOwner);

  if (error) {
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/reactions`, method: "DELETE", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
