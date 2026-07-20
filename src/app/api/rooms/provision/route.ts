import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createClient } from "@/lib/supabase/server";
import { getRoomByUserId } from "@/lib/owned-room";
import { checkRateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";
import { logError } from "@/lib/error-logger";

/**
 * POST idempotent find-or-create of the authed user's room.
 *
 * Mobile clients sign in natively (signInWithIdToken) and never pass through
 * the web /auth/callback route, so they call this instead to get the same
 * first-sign-in provisioning. Safe to call on every app launch.
 *
 * Response: { slug, display_name, needs_onboarding, created }
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Anonymous visitors never own rooms (same rule as the owner pages).
  if (user.is_anonymous) {
    return NextResponse.json(
      { error: "A permanent account is required to own a link" },
      { status: 403 }
    );
  }

  const existing = await getRoomByUserId(user.id);
  if (existing) {
    return NextResponse.json({
      id: existing.id,
      slug: existing.slug,
      display_name: existing.display_name,
      needs_onboarding: existing.needsOnboarding,
      created: false,
    });
  }

  // Only rate-limit actual creation, not the idempotent lookup path.
  const ip = getClientIp(req);
  const rl = checkRateLimit(
    `provision:${ip}`,
    LIMITS.createRoom.limit,
    LIMITS.createRoom.windowMs
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  // Mirrors /auth/callback first-sign-in provisioning.
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
      // owner_token is NOT NULL; provide it explicitly so the insert works
      // even if migration 030 (column default) hasn't run yet.
      owner_token: crypto.randomUUID(),
    })
    .select("id, slug, display_name")
    .single();

  if (insertError || !newRoom) {
    // Concurrent provision (e.g. two devices signing in at once) loses the
    // race on the rooms.user_id UNIQUE constraint re-read instead of failing.
    if (insertError?.code === "23505") {
      const raced = await getRoomByUserId(user.id);
      if (raced) {
        return NextResponse.json({
          id: raced.id,
          slug: raced.slug,
          display_name: raced.display_name,
          needs_onboarding: raced.needsOnboarding,
          created: false,
        });
      }
    }

    // Never swallow DB errors on provisioning routes (tasks/lessons.md).
    const message = insertError?.message ?? "Room insert returned no row";
    console.error("[rooms/provision] Room creation failed:", message);
    logError({
      message: `Provision room creation failed: ${message}`,
      endpoint: "/api/rooms/provision",
      method: "POST",
      statusCode: 500,
    });
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: newRoom.id,
      slug: newRoom.slug,
      display_name: newRoom.display_name,
      needs_onboarding: true,
      created: true,
    },
    { status: 201 }
  );
}
