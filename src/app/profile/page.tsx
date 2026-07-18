import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import ProfileClient from "./ProfileClient";

export const metadata: Metadata = { title: "Profile · Wolow" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous visitor sessions have no profile require a real account
  if (!user || user.is_anonymous) {
    redirect("/?next=/profile");
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("slug, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    avatar_url?: string;
  };

  return (
    <ProfileClient
      email={user.email ?? null}
      fullName={meta.full_name ?? null}
      avatarUrl={meta.avatar_url ?? null}
      slug={room?.slug ?? null}
      displayName={room?.display_name ?? null}
    />
  );
}
