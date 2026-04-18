import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimitDetailed, getClientIp, LIMITS } from "@/lib/rate-limit";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { logSecurityEvent } from "@/lib/security-logger";
import { safeCompare } from "@/lib/safe-compare";
import { logError } from "@/lib/error-logger";
import { sendPushNotifications } from "@/lib/push-notify";

type Params = { params: Promise<{ slug: string }> };

// A03: Strip all HTML tags and decode entities to prevent stored XSS.
// Using a strict allowlist approach: extract only text content.
function sanitizeText(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")       // strip tags
    .replace(/&lt;/gi, "<")         // decode common entities
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token, user_id")
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
  const viewerIsOwner = safeCompare(ownerToken, room.owner_token);

  const supabase = await createClient();
  // Also check auth-based ownership (for users signed in without the legacy cookie)
  let isOwnerByAuth = false;
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.id === room.user_id) {
    isOwnerByAuth = true;
  }
  const effectiveIsOwner = viewerIsOwner || isOwnerByAuth;
  let query = supabase
    .from("messages")
    .select("id, content, is_owner, created_at, reply_to_message_id, encrypted_content")
    .eq("room_id", room.id);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  let { data, error } = await query.order("created_at", { ascending: true });

  if (error?.message?.includes("reply_to_message_id")) {
    let fallbackQuery = supabase
      .from("messages")
      .select("id, content, is_owner, created_at, encrypted_content")
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
    logError({ message: error.message, endpoint: `/api/rooms/${slug}/messages`, method: "GET", statusCode: 500, slug });
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
    logError({ message: reactionsError.message, endpoint: `/api/rooms/${slug}/messages`, method: "GET", statusCode: 500, slug });
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
    if (reaction.is_owner === effectiveIsOwner) {
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

  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Hybrid rate limiting:
  // 1) fast in-memory check on every request (low latency)
  // 2) shared DB enforcement when close to limit or over local limit
  const ip = getClientIp(req);
  const key = `send-message:${ip}`;
  const local = checkRateLimitDetailed(key, LIMITS.sendMessage.limit, LIMITS.sendMessage.windowMs);
  const nearLimit = local.ok && local.remaining <= 2;
  if (!local.ok || nearLimit) {
    const db = await checkRateLimitDb(key, LIMITS.sendMessage.limit, LIMITS.sendMessage.windowMs);
    if (!db.ok) {
      logSecurityEvent("rate_limit_hit", { endpoint: "send-message", ip, retryAfter: db.retryAfter });
      return NextResponse.json(
        { error: "Too many messages. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(db.retryAfter) },
        }
      );
    }
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

  const content = sanitizeText(raw).trim();

  // When encrypted_content is provided, the plaintext `content` is a fallback placeholder.
  // Validate the plaintext only when NOT end-to-end encrypted.
  const hasEncrypted =
    typeof (body as Record<string, unknown>).encrypted_content === "string" &&
    ((body as Record<string, unknown>).encrypted_content as string).length > 0;

  if (!hasEncrypted && content.length < 1) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 422 });
  }
  if (!hasEncrypted && content.length > 1000) {
    return NextResponse.json(
      { error: "Message must be 1000 characters or fewer" },
      { status: 422 }
    );
  }

  // A04: Limit encrypted payload size to prevent abuse (max ~50 KB)
  if (hasEncrypted && ((body as Record<string, unknown>).encrypted_content as string).length > 50_000) {
    return NextResponse.json(
      { error: "Encrypted payload too large" },
      { status: 413 }
    );
  }

  // For E2EE messages, store a placeholder so the DB content column is never null.
  const storedContent = hasEncrypted ? "\u{1F512}" : content;

  // Determine if the sender is the room owner via Supabase auth (preferred)
  // Fall back to legacy httpOnly cookie for backwards compatibility
  const cookieStore = await cookies();
  const ownerCookie = cookieStore.get(`owner_${slug}`)?.value;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isOwnerByAuth = !!user && user.id === room.user_id;
  const isOwnerByCookie = safeCompare(ownerCookie, room.owner_token);
  const ownerTokenForRpc = (isOwnerByAuth || isOwnerByCookie) ? room.owner_token : null;

  const conversationId =
    typeof (body as Record<string, unknown>).conversation_id === "string"
      ? ((body as Record<string, unknown>).conversation_id as string)
      : null;

  const replyToMessageId =
    typeof (body as Record<string, unknown>).reply_to_message_id === "string"
      ? ((body as Record<string, unknown>).reply_to_message_id as string)
      : null;

  const encryptedContent =
    typeof (body as Record<string, unknown>).encrypted_content === "string"
      ? ((body as Record<string, unknown>).encrypted_content as string)
      : null;

  const senderPublicKeyId =
    typeof (body as Record<string, unknown>).sender_public_key_id === "string"
      ? ((body as Record<string, unknown>).sender_public_key_id as string)
      : null;

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("send_message_secure", {
    p_slug: slug,
    p_conversation_id: conversationId,
    p_content: storedContent,
    p_reply_to_message_id: replyToMessageId,
    p_owner_token: ownerTokenForRpc,
    p_encrypted_content: encryptedContent,
    p_sender_public_key_id: senderPublicKeyId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ROOM_NOT_FOUND")) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (msg.includes("CONVERSATION_NOT_FOUND") || msg.includes("CONVERSATION_REQUIRED")) {
      logSecurityEvent("cross_resource_access", { endpoint: "send-message", slug, ip });
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (msg.includes("REPLY_TARGET_NOT_FOUND")) {
      return NextResponse.json({ error: "Reply target not found" }, { status: 422 });
    }
    if (msg.includes("REPLY_TARGET_WRONG_CONVERSATION")) {
      return NextResponse.json({ error: "Reply target must be in the same conversation" }, { status: 422 });
    }
    logError({ message: msg, endpoint: `/api/rooms/${slug}/messages`, method: "POST", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  const inserted = Array.isArray(data) ? data[0] : null;
  if (!inserted) {
    logError({ message: "RPC returned no data", endpoint: `/api/rooms/${slug}/messages`, method: "POST", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  // Fire-and-forget push notification to the other party
  void sendPushNotifications({
    roomId: inserted.room_id,
    slug,
    conversationId: inserted.conversation_id,
    senderIsOwner: inserted.is_owner,
    // For E2EE messages, omit content preview to avoid leaking plaintext
    contentPreview: hasEncrypted ? undefined : content,
  });

  return NextResponse.json({ ok: true, message: inserted }, { status: 201 });
}
