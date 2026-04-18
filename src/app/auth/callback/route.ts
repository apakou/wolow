import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { nanoid } from "nanoid";

/**
 * OAuth callback — exchanges the PKCE code for a session, ensures the user
 * has a permanent room (creates one on first sign-in), then redirects.
 *
 * IMPORTANT: We build the redirect response up front and bind Supabase's
 * cookie adapter to it. Returning a fresh NextResponse after the exchange
 * would drop the auth cookies and the user would land back on the login page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Provisional redirect target — may be overwritten below once we know the slug.
  let response = NextResponse.redirect(`${origin}/?auth_error=1`);

  if (!code) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error("[auth/callback] exchangeCodeForSession failed:", exchangeError);
    return response; // already points at /?auth_error=1, cookies preserved
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return response;

  // Find this user's existing room, or create one.
  const { data: existingRoom, error: lookupError } = await supabase
    .from("rooms")
    .select("slug")
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    console.error("[auth/callback] room lookup failed:", lookupError);
    response = buildRedirect(request, response, `${origin}/?auth_error=room_lookup`);
    return response;
  }

  let slug: string;

  if (existingRoom) {
    slug = existingRoom.slug;
  } else {
    const displayName =
      user.user_metadata?.full_name?.split(" ")[0] ??
      user.email?.split("@")[0] ??
      "anon";

    const { data: newRoom, error: insertError } = await supabase
      .from("rooms")
      .insert({
        slug: nanoid(10),
        owner_token: nanoid(24),
        display_name: displayName,
        user_id: user.id,
      })
      .select("slug")
      .single();

    if (insertError || !newRoom) {
      console.error("[auth/callback] Failed to create room:", insertError);
      response = buildRedirect(request, response, `${origin}/?auth_error=room_create`);
      return response;
    }

    slug = newRoom.slug;
  }

  const destination = next ?? `/${slug}/inbox`;
  response = buildRedirect(request, response, `${origin}${destination}`);
  return response;
}

/**
 * Build a new redirect response while preserving the auth cookies that
 * Supabase wrote onto the previous response object.
 */
function buildRedirect(
  _request: NextRequest,
  previous: NextResponse,
  url: string
): NextResponse {
  const next = NextResponse.redirect(url);
  previous.cookies.getAll().forEach((cookie) => {
    next.cookies.set(cookie);
  });
  return next;
}
