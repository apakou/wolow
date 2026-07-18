import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";

/**
 * OAuth callback exchanges the PKCE code for a session, ensures the user
 * has a permanent room (creates one on first sign-in), then redirects.
 * Brand-new users are sent to /welcome (onboarding) instead of the inbox.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Find this user's existing room, or create one
        const { data: existingRoom } = await supabase
          .from("rooms")
          .select("slug")
          .eq("user_id", user.id)
          .single();

        let slug: string;
        let isNewUser = false;

        if (existingRoom) {
          slug = existingRoom.slug;
        } else {
          // First sign-in create a permanent room for this user
          const displayName =
            user.user_metadata?.full_name?.split(" ")[0] ??
            user.email?.split("@")[0] ??
            "anon";

          const { data: newRoom, error: insertError } = await supabase
            .from("rooms")
            .insert({
              slug: nanoid(10),
              display_name: displayName,
              user_id: user.id,
              // owner_token is NOT NULL; provide it explicitly so the insert
              // works even if migration 030 (column default) hasn't run yet.
              owner_token: crypto.randomUUID(),
            })
            .select("slug")
            .single();

          if (insertError || !newRoom) {
            // Never swallow DB errors on auth routes (tasks/lessons.md).
            const message = insertError?.message ?? "Room insert returned no row";
            console.error("[auth/callback] First sign-in room creation failed:", message);
            logError({
              message: `First sign-in room creation failed: ${message}`,
              endpoint: "/auth/callback",
              method: "GET",
              statusCode: 500,
            });
            return NextResponse.redirect(`${origin}/?auth_error=1`);
          }

          slug = newRoom.slug;
          isNewUser = true;
        }

        // If a ?next= was passed (e.g. visitor going to /{otherSlug}), honour
        // it never hijack a visitor's intent with onboarding. Otherwise,
        // brand-new owners go through the /welcome onboarding flow.
        const destination = next ?? (isNewUser ? "/welcome" : `/${slug}/inbox`);
        return NextResponse.redirect(`${origin}${destination}`);
      }
    }
  }

  // Something went wrong send back to the home page
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
