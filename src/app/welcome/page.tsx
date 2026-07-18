import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRoomByUserId } from "@/lib/owned-room";
import WelcomeWizard from "./components/WelcomeWizard";

export const metadata: Metadata = { title: "Welcome to Wolow" };

/**
 * Onboarding (NGL-style): claim your link → copy it → share it.
 * Shown once, right after first sign-in; re-entered on next sign-in if
 * the user dropped off before finishing.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/?next=/welcome");
  }

  const room = await getRoomByUserId(user.id);

  if (!room) {
    // Auto-provisioning failed — home page surfaces sign-in / error state
    redirect("/");
  }

  if (!room.needsOnboarding) {
    redirect(`/${room.slug}/inbox`);
  }

  return (
    <WelcomeWizard
      initialSlug={room.slug}
      initialDisplayName={room.display_name}
    />
  );
}
