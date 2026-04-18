import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

export const metadata: Metadata = { title: "Settings · Wolow" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/?next=/settings`);
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, display_name, owner_key_fingerprint, owner_public_key_rotated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!room) {
    // Rooms are created automatically on first sign-in by /auth/callback.
    // Reaching this branch means the callback insert failed — surface that
    // clearly rather than offering a non-existent "create" action.
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-app-gradient px-6 text-center gap-3">
        <p className="text-slate-300">We couldn&apos;t find your room.</p>
        <p className="text-muted text-sm">
          This usually clears up after signing out and back in. If it keeps
          happening, please report it.
        </p>
      </div>
    );
  }

  return (
    <SettingsClient
      slug={room.slug}
      displayName={room.display_name}
      serverFingerprint={room.owner_key_fingerprint}
      rotatedAt={room.owner_public_key_rotated_at}
    />
  );
}
