import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getFunAnonymousName } from "@/lib/fun-anonymous-name";
import OwnerThread from "./components/OwnerThread";

type Props = { params: Promise<{ slug: string; conversationId: string }> };

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: Props) {
  const { slug, conversationId } = await params;

  // Verify owner via Supabase auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect(`/?next=/${slug}/inbox/${conversationId}`);
  }

  // Load room
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, display_name, user_id")
    .eq("slug", slug)
    .single();

  if (!room || room.user_id !== user.id) {
    redirect(`/${slug}`);
  }

  // Verify conversation belongs to this room (blocked_at falls back for
  // databases missing migration 029)
  let conversation: { id: string; blocked_at: string | null } | null = null;
  const { data: convData } = await supabase
    .from("conversations")
    .select("id, blocked_at")
    .eq("id", conversationId)
    .eq("room_id", room.id)
    .single();
  conversation = convData ?? null;

  if (!conversation) {
    const { data: fallback } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("room_id", room.id)
      .single();
    conversation = fallback ? { id: fallback.id, blocked_at: null } : null;
  }

  if (!conversation) {
    notFound();
  }

  const label = getFunAnonymousName(conversationId);

  return (
    <OwnerThread
      roomId={room.id}
      slug={room.slug}
      displayName={room.display_name}
      conversationId={conversationId}
      conversationLabel={label}
      initiallyBlocked={Boolean(conversation.blocked_at)}
    />
  );
}
