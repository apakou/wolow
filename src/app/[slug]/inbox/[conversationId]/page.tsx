import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getFunAnonymousName } from "@/lib/fun-anonymous-name";
import { safeCompare } from "@/lib/safe-compare";
import OwnerThread from "./components/OwnerThread";

type Props = { params: Promise<{ slug: string; conversationId: string }> };

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: Props) {
  const { slug, conversationId } = await params;

  // Verify owner
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Load room
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, display_name, owner_token, user_id")
    .eq("slug", slug)
    .single();

  const authorizedByToken = !!ownerToken && !!room && safeCompare(ownerToken, room.owner_token);
  const authorizedByUser = !!user && !!room?.user_id && user.id === room.user_id;

  if (!room || (!authorizedByToken && !authorizedByUser)) {
    redirect("/");
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

  const label = getFunAnonymousName(conversationId);

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
