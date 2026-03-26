import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import OwnerInbox from "./components/OwnerInbox";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Your inbox" };

export default async function InboxPage({ params }: Props) {
  const { slug } = await params;

  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;

  if (!ownerToken) {
    redirect(`/${slug}`);
  }

  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, display_name, owner_token")
    .eq("slug", slug)
    .single();

  if (!room || room.owner_token !== ownerToken) {
    redirect(`/${slug}`);
  }

  return (
    <OwnerInbox
      roomId={room.id}
      slug={room.slug}
      displayName={room.display_name}
    />
  );
}
