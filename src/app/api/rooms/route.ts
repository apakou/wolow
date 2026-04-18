import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";

/**
 * GET — list rooms owned by the authenticated user.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("id, slug, display_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    logError({ message: error.message, endpoint: "/api/rooms", method: "GET", statusCode: 500 });
    return NextResponse.json({ error: "Failed to fetch rooms" }, { status: 500 });
  }

  return NextResponse.json(rooms ?? []);
}
