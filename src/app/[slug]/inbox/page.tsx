import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRoomBySlug } from "@/lib/owned-room";
import OwnerInbox from "./components/OwnerInbox";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Your inbox" };

export default async function InboxPage({ params }: Props) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/?next=/${slug}/inbox`);
  }

  const room = await getRoomBySlug(slug);

  if (!room || room.user_id !== user.id) {
    // Authenticated but not the owner of this room
    redirect(`/${slug}`);
  }

  if (room.needsOnboarding) {
    // Finish onboarding first — this also guarantees slug changes happen
    // before OwnerInbox generates E2EE keys (keyed by room:{slug}).
    redirect("/welcome");
  }

  return (
    <OwnerInbox
      roomId={room.id}
      slug={room.slug}
      displayName={room.display_name}
    />
  );
}
