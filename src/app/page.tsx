import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRoomByUserId } from "@/lib/owned-room";
import SignInWithGoogle from "./components/SignInWithGoogle";

type Props = { searchParams: Promise<{ next?: string; auth_error?: string }> };

export default async function Home({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous visitor sessions never own rooms; only real accounts get
  // forwarded to their inbox.
  if (user && !user.is_anonymous) {
    const room = await getRoomByUserId(user.id);

    if (room) {
      redirect(room.needsOnboarding ? "/welcome" : `/${room.slug}/inbox`);
    }
    // No room yet auth callback will create one; show sign-in again
  }

  const { next, auth_error: authError } = await searchParams;

  // Visitor context: when arriving via a shared link (?next=/{slug}), look up
  // the inviter so the sign-in screen can say who they're about to message.
  let inviterName: string | null = null;
  const slugMatch = next?.match(/^\/([A-Za-z0-9_-]{3,32})$/);
  if (slugMatch) {
    const { data: room } = await supabase
      .from("rooms")
      .select("display_name")
      .eq("slug", slugMatch[1])
      .single();
    inviterName = room?.display_name ?? null;
  }

  return (
    <SignInWithGoogle
      next={next}
      inviterName={inviterName}
      authError={authError ?? null}
    />
  );
}
