import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignInWithGoogle from "./components/SignInWithGoogle";

type Props = { searchParams: Promise<{ next?: string; auth_error?: string }> };

export default async function Home({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: room } = await supabase
      .from("rooms")
      .select("slug")
      .eq("user_id", user.id)
      .single();

    if (room) {
      redirect(`/${room.slug}/inbox`);
    }
    // No room yet — auth callback will create one; show sign-in again
  }

  const { next } = await searchParams;
  return <SignInWithGoogle next={next} />;
}
