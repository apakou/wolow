import { createClient } from "@/lib/supabase/server";

export type RoomWithOnboarding = {
  id: string;
  slug: string;
  display_name: string;
  user_id: string | null;
  /** True when the owner hasn't finished the /welcome flow yet. */
  needsOnboarding: boolean;
};

/**
 * Fetch a room together with its onboarding state, resilient to
 * migration 027 not having been applied yet.
 *
 * If selecting `onboarding_completed_at` fails (undefined column), we
 * log loudly and fall back to a legacy select, treating the room as
 * already onboarded sign-in and inbox must keep working even when
 * the code ships ahead of the migration (tasks/lessons.md: degrade,
 * don't hard-error; but never silently).
 */
async function fetchRoom(
  column: "user_id" | "slug",
  value: string
): Promise<RoomWithOnboarding | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("rooms")
    .select("id, slug, display_name, user_id, onboarding_completed_at")
    .eq(column, value)
    .maybeSingle();

  if (!error) {
    if (!data) return null;
    return {
      id: data.id,
      slug: data.slug,
      display_name: data.display_name,
      user_id: data.user_id,
      needsOnboarding: data.onboarding_completed_at === null,
    };
  }

  console.error(
    `[owned-room] Select with onboarding_completed_at failed (${error.code ?? "?"}): ` +
      `${error.message} is migration 027_onboarding.sql applied? Falling back.`
  );

  const { data: fallback, error: fallbackError } = await supabase
    .from("rooms")
    .select("id, slug, display_name, user_id")
    .eq(column, value)
    .maybeSingle();

  if (fallbackError) {
    console.error(`[owned-room] Fallback select failed: ${fallbackError.message}`);
    return null;
  }
  if (!fallback) return null;

  // Migration missing → skip onboarding rather than break the app.
  return { ...fallback, needsOnboarding: false };
}

/** The signed-in user's own room (one room per user). */
export function getRoomByUserId(userId: string) {
  return fetchRoom("user_id", userId);
}

/** A room by its public slug. */
export function getRoomBySlug(slug: string) {
  return fetchRoom("slug", slug);
}
