import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Never crash middleware in production; skip session refresh if env is missing.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[middleware] Supabase env vars are missing; skipping session refresh");
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // Refresh session — do not add any logic between createServerClient and getUser
    // that could cause the session cookie to be missing on the response.
    await supabase.auth.getUser();
    return supabaseResponse;
  } catch (error) {
    console.error("[middleware] session refresh failed", error);
    return NextResponse.next({ request });
  }
}
