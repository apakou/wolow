import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
 * PUT /api/rooms/[slug]/conversations/keys
 *
 * Sets the visitor's public key on a conversation. Requires the sender cookie.
 * Only sets the key if it hasn't been set yet (cannot overwrite).
 */
export async function PUT(req: Request, { params }: Params) {
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

  const conversationId =
    typeof (body as Record<string, unknown>).conversation_id === "string"
      ? ((body as Record<string, unknown>).conversation_id as string)
      : null;

  const publicKey = (body as Record<string, unknown>).public_key;

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 422 });
  }
  if (!publicKey || typeof publicKey !== "object") {
    return NextResponse.json({ error: "public_key is required" }, { status: 422 });
  }

  // Verify sender owns this conversation via cookie
  const cookieStore = await cookies();
  const senderToken = cookieStore.get(`sender_${slug}`)?.value;

  const supabase = await createClient();

  // Fetch the conversation and verify ownership
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, sender_token, visitor_public_key")
    .eq("id", conversationId)
    .eq("room_id", room.id)
    .single();

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Only the conversation's sender can set the visitor public key
  const isSender = senderToken && senderToken === conv.sender_token;

  if (!isSender) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (conv.visitor_public_key) {
    return NextResponse.json({ ok: true, message: "Key already set" });
  }

  const { error } = await supabase
    .from("conversations")
    .update({ visitor_public_key: publicKey })
    .eq("id", conversationId);

  if (error) {
    return NextResponse.json({ error: "Failed to store key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
