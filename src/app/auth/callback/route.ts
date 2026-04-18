import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback — exchanges the PKCE code for a session, ensures the user
 * has a permanent room (creates one on first sign-in), then redirects.
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

        if (existingRoom) {
          slug = existingRoom.slug;
        } else {
          // First sign-in — create a permanent room for this user
          const displayName =
            user.user_metadata?.full_name?.split(" ")[0] ??
            user.email?.split("@")[0] ??
            "anon";

          const { data: newRoom, error: insertError } = await supabase
            .from("rooms")
            .insert({ slug: nanoid(10), display_name: displayName, user_id: user.id })
            .select("slug")
            .single();

          if (insertError || !newRoom) {
            return NextResponse.redirect(`${origin}/?auth_error=1`);
          }

          slug = newRoom.slug;
        }

        // If a ?next= was passed (e.g. visitor going to /{otherSlug}), honour it
        const destination = next ?? `/${slug}/inbox`;
        return NextResponse.redirect(`${origin}${destination}`);
      }
    }
  }

  // Something went wrong — send back to the home page
  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
