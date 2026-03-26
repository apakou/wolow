import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import OwnerThread from "./components/OwnerThread";

type Props = { params: Promise<{ slug: string; conversationId: string }> };

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: Props) {
  const { slug, conversationId } = await params;

  // Verify owner
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  if (!ownerToken) {
    redirect(`/${slug}`);
  }

  const supabase = await createClient();

  // Load room
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, display_name, owner_token")
    .eq("slug", slug)
    .single();

  if (!room || room.owner_token !== ownerToken) {
    redirect(`/${slug}`);
  }

  // Verify conversation belongs to this room
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("room_id", room.id)
    .single();

  if (!conversation) {
    notFound();
  }

  // Determine label (position among all conversations for this room)
  const { data: allConversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });

  const index = (allConversations ?? []).findIndex((c) => c.id === conversationId);
  const label = `Anonymous #${index + 1}`;

  return (
    <OwnerThread
      roomId={room.id}
      slug={room.slug}
      displayName={room.display_name}
      conversationId={conversationId}
      conversationLabel={label}
    />
  );
}
