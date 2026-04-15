"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-xs text-muted hover:text-slate-300 transition px-3 py-1.5 rounded-xl
                 border border-border hover:border-border-hover bg-surface-light/50"
    >
      Sign out
    </button>
  );
}
