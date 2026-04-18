import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";

type Params = { params: Promise<{ slug: string }> };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

/**
 * PUT /api/rooms/[slug]/conversations/keys
 *
 * Sets the visitor's public key on a conversation. Requires the authenticated sender.
 * Only sets the key if it hasn't been set yet (cannot overwrite).
 */
export async function PUT(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // Fetch the conversation and verify ownership
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, sender_user_id, visitor_public_key")
    .eq("id", conversationId)
    .eq("room_id", room.id)
    .single();

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Only the conversation's sender can set the visitor public key
  if (user.id !== conv.sender_user_id) {
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
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/conversations/keys`, method: "PUT", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to store key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
