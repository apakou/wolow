import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/**
 * Server-side Supabase client.
 *
 * Two auth transports:
 * 1. Cookies (web) the @supabase/ssr cookie bridge, refreshed by middleware.
 * 2. `Authorization: Bearer <access_token>` (mobile/API clients) the header
 *    is forwarded to PostgREST so RLS sees the user's JWT, and getUser() is
 *    bound to the token so every existing route handler works unchanged.
 *
 * The bearer path never writes cookies and never attempts session refresh;
 * expired tokens simply yield `user: null` (routes already treat that as
 * signed-out) and the mobile client refreshes via supabase_flutter.
 */
export async function createClient() {
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization") ?? "";
  const bearerToken = /^bearer /i.test(authHeader)
    ? authHeader.slice(7).trim()
    : null;

  if (bearerToken) {
    const client = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: { Authorization: `Bearer ${bearerToken}` },
        },
        // No cookie storage: bearer requests are stateless.
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      }
    );

    // Route handlers call `auth.getUser()` with no arguments, which reads the
    // (empty) cookie session. Bind the bearer token as the default so the
    // token is validated against the auth server instead.
    const originalGetUser = client.auth.getUser.bind(client.auth);
    client.auth.getUser = ((jwt?: string) =>
      originalGetUser(jwt ?? bearerToken)) as typeof client.auth.getUser;

    return client;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component session refresh handled by middleware
          }
        },
      },
    }
  );
}
