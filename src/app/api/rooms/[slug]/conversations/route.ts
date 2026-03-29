import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFunAnonymousName } from "@/lib/fun-anonymous-name";
import { logSecurityEvent } from "@/lib/security-logger";
import { safeCompare } from "@/lib/safe-compare";
import { logError } from "@/lib/error-logger";
import type { SupabaseClient } from "@supabase/supabase-js";

type Params = { params: Promise<{ slug: string }> };

type ConvRow = { id: string; created_at: string; owner_last_read_at: string | null };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

// Shared helper: given a list of conversation rows, fetch messages and build the response
async function buildConversationResponse(
  conversations: ConvRow[],
  supabase: SupabaseClient,
) {
  if (conversations.length === 0) {
    return NextResponse.json([]);
  }

  const conversationIds = conversations.map((c) => c.id);
  const { data: messages } = await supabase
    .from("messages")
    .select("conversation_id, content, is_owner, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  const latestMap = new Map<string, { content: string; is_owner: boolean; created_at: string }>();
  const countMap = new Map<string, number>();
  const unreadMap = new Map<string, number>();

  const lastReadMap = new Map<string, string | null>();
  for (const conv of conversations) {
    lastReadMap.set(conv.id, conv.owner_last_read_at);
  }

  for (const msg of messages ?? []) {
    if (!latestMap.has(msg.conversation_id)) {
      latestMap.set(msg.conversation_id, msg);
    }
    countMap.set(msg.conversation_id, (countMap.get(msg.conversation_id) ?? 0) + 1);

    if (!msg.is_owner) {
      const lastRead = lastReadMap.get(msg.conversation_id);
      if (!lastRead || new Date(msg.created_at) > new Date(lastRead)) {
        unreadMap.set(msg.conversation_id, (unreadMap.get(msg.conversation_id) ?? 0) + 1);
      }
    }
  }

  const result = conversations
    .map((conv) => {
      const latest = latestMap.get(conv.id);
      return {
        id: conv.id,
        label: getFunAnonymousName(conv.id),
        created_at: conv.created_at,
        message_count: countMap.get(conv.id) ?? 0,
        unread_count: unreadMap.get(conv.id) ?? 0,
        last_message: latest
          ? {
              content: latest.content.slice(0, 80),
              is_owner: latest.is_owner,
              created_at: latest.created_at,
            }
          : null,
      };
    })
    .sort((a, b) => {
      const aTime = a.last_message?.created_at ?? a.created_at;
      const bTime = b.last_message?.created_at ?? b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

  return NextResponse.json(result);
}

/**
 * POST /api/rooms/[slug]/conversations
 *
 * Called by the anonymous sender on page load.
 * Upserts a conversation for this (room, sender) pair and
 * sets the sender cookie if new.
 */
export async function POST(_req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  let senderToken = cookieStore.get(`sender_${slug}`)?.value;
  const isNewSender = !senderToken;

  if (!senderToken) {
    senderToken = crypto.randomUUID();
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("conversations")
    .upsert(
      { room_id: room.id, sender_token: senderToken },
      { onConflict: "room_id,sender_token" }
    )
    .select("id")
    .single();

  if (error || !data) {
    logError({ message: error?.message ?? "No data returned", endpoint: `/api/rooms/${slug}/conversations`, method: "POST", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }

  const res = NextResponse.json({ conversation_id: data.id });

  if (isNewSender) {
    res.cookies.set(`sender_${slug}`, senderToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return res;
}

/**
 * GET /api/rooms/[slug]/conversations
 *
 * Called by the room owner to list all conversations with latest message.
 * Requires the owner cookie.
 */
export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  if (!ownerToken || !safeCompare(ownerToken, room.owner_token)) {
    logSecurityEvent("auth_failure", { endpoint: "GET /conversations", slug });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = await createClient();

  // Try with owner_last_read_at first; fall back if column doesn't exist yet
  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id, created_at, owner_last_read_at")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });

  if (error?.message?.includes("owner_last_read_at")) {
    const { data: fallback, error: fbErr } = await supabase
      .from("conversations")
      .select("id, created_at")
      .eq("room_id", room.id)
      .order("created_at", { ascending: true });

    if (fbErr || !fallback) {
      logError({ message: fbErr?.message ?? "Fallback returned no data", endpoint: `/api/rooms/${slug}/conversations`, method: "GET", statusCode: 500, slug });
      return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
    }

    return buildConversationResponse(
      fallback.map((c) => ({ ...c, owner_last_read_at: null })),
      supabase,
    );
  }

  if (error) {
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/conversations`, method: "GET", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }

  return buildConversationResponse(conversations ?? [], supabase);
}

/**
 * PATCH /api/rooms/[slug]/conversations
 *
 * Marks a conversation as read by the owner.
 * Body: { conversation_id: string }
 */
export async function PATCH(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  if (!ownerToken || !safeCompare(ownerToken, room.owner_token)) {
    logSecurityEvent("auth_failure", { endpoint: "PATCH /conversations", slug });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 422 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("conversations")
    .update({ owner_last_read_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("room_id", room.id);

  if (error) {
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/conversations`, method: "PATCH", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to mark as read" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
