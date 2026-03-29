import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("id, slug, display_name, created_at, is_archived, deleted_at")
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch rooms" }, { status: 500 });
  }

  const rooms = data ?? [];
  if (rooms.length === 0) {
    return NextResponse.json([]);
  }

  const roomIds = rooms.map((room) => room.id);
  const { data: conversations, error: conversationsError } = await supabase
    .from("conversations")
    .select("id, room_id, created_at, owner_last_read_at")
    .in("room_id", roomIds);

  if (conversationsError?.message?.includes("owner_last_read_at")) {
    const fallbackRooms = rooms.map((room) => ({
      ...room,
      has_unread: false,
      unread_count: 0,
    }));
    return NextResponse.json(fallbackRooms);
  }

  if (conversationsError) {
    return NextResponse.json({ error: "Failed to fetch room conversations" }, { status: 500 });
  }

  const conversationRows = conversations ?? [];
  if (conversationRows.length === 0) {
    return NextResponse.json(
      rooms.map((room) => ({
        ...room,
        has_unread: false,
        unread_count: 0,
      }))
    );
  }

  const conversationIds = conversationRows.map((conversation) => conversation.id);
  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("conversation_id, is_owner, created_at")
    .in("conversation_id", conversationIds);

  if (messagesError) {
    return NextResponse.json({ error: "Failed to fetch unread counts" }, { status: 500 });
  }

  const roomByConversationId = new Map(conversationRows.map((conversation) => [conversation.id, conversation.room_id]));
  const lastReadByConversationId = new Map(
    conversationRows.map((conversation) => [conversation.id, conversation.owner_last_read_at])
  );
  const unreadByRoomId = new Map<string, number>();

  for (const message of messages ?? []) {
    if (message.is_owner) {
      continue;
    }

    const lastRead = lastReadByConversationId.get(message.conversation_id);
    if (lastRead && new Date(message.created_at) <= new Date(lastRead)) {
      continue;
    }

    const roomId = roomByConversationId.get(message.conversation_id);
    if (!roomId) {
      continue;
    }

    unreadByRoomId.set(roomId, (unreadByRoomId.get(roomId) ?? 0) + 1);
  }

  return NextResponse.json(
    rooms.map((room) => {
      const unreadCount = unreadByRoomId.get(room.id) ?? 0;
      return {
        ...room,
        has_unread: unreadCount > 0,
        unread_count: unreadCount,
      };
    })
  );
}