import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";
import { logSecurityEvent } from "@/lib/security-logger";
import { validateSlug, SLUG_ERROR_MESSAGES } from "@/lib/slug";

type Params = { params: Promise<{ slug: string }> };

const NAME_MAX = 40;

type PatchBody = {
  display_name?: unknown;
  slug?: unknown;
  onboarding_completed?: unknown;
};

/**
 * PATCH /api/rooms/[slug]
 *
 * Owner-only room updates, used by the /welcome onboarding wizard:
 *   - display_name          (1–40 chars)
 *   - slug                  (validated against src/lib/slug.ts rules)
 *   - onboarding_completed  (true → stamps onboarding_completed_at)
 *
 * Requires migration 027 (rooms_update_owner_user policy) without it
 * the UPDATE matches 0 rows and this route fails loudly on purpose.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, user_id")
    .eq("slug", slug)
    .maybeSingle();

  if (roomError) {
    logError({ message: roomError.message, endpoint: `/api/rooms/${slug}`, method: "PATCH", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (!user || user.id !== room.user_id) {
    logSecurityEvent("auth_failure", { endpoint: "PATCH /api/rooms/[slug]", slug });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, string> = {};

  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string") {
      return NextResponse.json({ error: "display_name must be a string" }, { status: 400 });
    }
    const name = body.display_name.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Name must be 1–${NAME_MAX} characters.` },
        { status: 400 }
      );
    }
    updates.display_name = name;
  }

  if (body.slug !== undefined) {
    if (typeof body.slug !== "string") {
      return NextResponse.json({ error: "slug must be a string" }, { status: 400 });
    }
    const validation = validateSlug(body.slug);
    if (!validation.ok) {
      return NextResponse.json(
        { error: SLUG_ERROR_MESSAGES[validation.reason] },
        { status: 400 }
      );
    }
    updates.slug = validation.slug;
  }

  if (body.onboarding_completed === true) {
    updates.onboarding_completed_at = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("rooms")
    .update(updates)
    .eq("id", room.id)
    .select("slug, display_name, onboarding_completed_at")
    .maybeSingle();

  if (updateError) {
    // Unique violation on slug someone claimed it between check and save.
    if (updateError.code === "23505") {
      return NextResponse.json({ error: "That link is already taken." }, { status: 409 });
    }
    logError({ message: updateError.message, endpoint: `/api/rooms/${slug}`, method: "PATCH", statusCode: 500, slug });
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }

  if (!updated) {
    // RLS matched 0 rows: the rooms_update_owner_user policy is missing.
    // Fail loudly (tasks/lessons.md never mask migration gaps as success).
    const message =
      "Room update matched 0 rows is migration 027_onboarding.sql applied?";
    console.error(`[PATCH /api/rooms/${slug}] ${message}`);
    logError({ message, endpoint: `/api/rooms/${slug}`, method: "PATCH", statusCode: 500, slug });
    return NextResponse.json({ error: "Update not permitted" }, { status: 500 });
  }

  return NextResponse.json(updated);
}
