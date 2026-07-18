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

  if (user) {
    const room = await getRoomByUserId(user.id);

    if (room) {
      redirect(room.needsOnboarding ? "/welcome" : `/${room.slug}/inbox`);
    }
    // No room yet — auth callback will create one; show sign-in again
  }

  const { next } = await searchParams;
  return <SignInWithGoogle next={next} />;
}
