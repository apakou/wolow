import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClientIp, LIMITS } from "@/lib/rate-limit";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { logSecurityEvent } from "@/lib/security-logger";

type Params = { params: Promise<{ slug: string }> };

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  const viewerIsOwner = !!ownerToken && ownerToken === room.owner_token;

  const supabase = await createClient();
  let query = supabase
    .from("messages")
    .select("id, content, is_owner, created_at, reply_to_message_id")
    .eq("room_id", room.id);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  let { data, error } = await query.order("created_at", { ascending: true });

  if (error?.message?.includes("reply_to_message_id")) {
    let fallbackQuery = supabase
      .from("messages")
      .select("id, content, is_owner, created_at")
      .eq("room_id", room.id);

    if (conversationId) {
      fallbackQuery = fallbackQuery.eq("conversation_id", conversationId);
    }

    const fallback = await fallbackQuery.order("created_at", { ascending: true });
    error = fallback.error;
    data = (fallback.data ?? []).map((message) => ({
      ...message,
      reply_to_message_id: null,
    }));
  }

  if (error) {
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }

  const messages = data ?? [];
  if (messages.length === 0) {
    return NextResponse.json(messages);
  }

  const messageIds = messages.map((message) => message.id);
  const { data: reactions, error: reactionsError } = await supabase
    .from("reactions")
    .select("message_id, emoji, is_owner")
    .in("message_id", messageIds);

  if (reactionsError) {
    return NextResponse.json({ error: "Failed to fetch reactions" }, { status: 500 });
  }

  const reactionMap = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>();
  for (const reaction of reactions ?? []) {
    let perMessage = reactionMap.get(reaction.message_id);
    if (!perMessage) {
      perMessage = new Map();
      reactionMap.set(reaction.message_id, perMessage);
    }

    const existing = perMessage.get(reaction.emoji) ?? { count: 0, reactedByMe: false };
    existing.count += 1;
    if (reaction.is_owner === viewerIsOwner) {
      existing.reactedByMe = true;
    }
    perMessage.set(reaction.emoji, existing);
  }

  const enriched = messages.map((message) => {
    const perEmoji = reactionMap.get(message.id);
    const reactionList = [...(perEmoji?.entries() ?? [])]
      .map(([emoji, payload]) => ({ emoji, count: payload.count, reactedByMe: payload.reactedByMe }))
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

    return {
      ...message,
      reactions: reactionList,
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params;

  // Rate limit: 10 messages per IP per minute (DB-backed, cross-instance)
  const ip = getClientIp(req);
  const rl = await checkRateLimitDb(`send-message:${ip}`, LIMITS.sendMessage.limit, LIMITS.sendMessage.windowMs);
  if (!rl.ok) {
    logSecurityEvent("rate_limit_hit", { endpoint: "send-message", ip, retryAfter: rl.retryAfter });
    return NextResponse.json(
      { error: "Too many messages. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof (body as Record<string, unknown>).content === "string"
      ? ((body as Record<string, unknown>).content as string).trim()
      : "";

  const content = stripHtml(raw).trim();

  if (content.length < 1) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 422 });
  }
  if (content.length > 1000) {
    return NextResponse.json(
      { error: "Message must be 1000 characters or fewer" },
      { status: 422 }
    );
  }

  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Determine if the sender is the room owner via httpOnly cookie
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  const is_owner = !!ownerToken && ownerToken === room.owner_token;

  const conversationId =
    typeof (body as Record<string, unknown>).conversation_id === "string"
      ? ((body as Record<string, unknown>).conversation_id as string)
      : null;

  const replyToMessageId =
    typeof (body as Record<string, unknown>).reply_to_message_id === "string"
      ? ((body as Record<string, unknown>).reply_to_message_id as string)
      : null;

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 422 });
  }

  const supabase = await createClient();

  // A01: Verify the conversation belongs to this room (prevents cross-room message injection)
  const { data: conversation, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("room_id", room.id)
    .single();

  if (convErr || !conversation) {
    logSecurityEvent("cross_resource_access", { endpoint: "send-message", slug, ip });
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (replyToMessageId) {
    const { data: targetMessage, error: targetError } = await supabase
      .from("messages")
      .select("id, conversation_id")
      .eq("id", replyToMessageId)
      .eq("room_id", room.id)
      .single();

    if (targetError || !targetMessage) {
      return NextResponse.json({ error: "Reply target not found" }, { status: 422 });
    }

    if (targetMessage.conversation_id !== conversationId) {
      return NextResponse.json({ error: "Reply target must be in the same conversation" }, { status: 422 });
    }
  }

  const { error } = await supabase
    .from("messages")
    .insert({
      room_id: room.id,
      content,
      is_owner,
      conversation_id: conversationId,
      reply_to_message_id: replyToMessageId,
    });

  if (error) {
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
