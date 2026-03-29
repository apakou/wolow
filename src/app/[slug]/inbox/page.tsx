import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { safeCompare } from "@/lib/safe-compare";
import OwnerInbox from "./components/OwnerInbox";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Your inbox" };

export default async function InboxPage({ params }: Props) {
  const { slug } = await params;

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  return (
    <OwnerInbox
      roomId={room.id}
      slug={room.slug}
      displayName={room.display_name}
    />
  );
}
