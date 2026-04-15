import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/[slug]/claim
 *
 * Verifies that the authenticated user owns this room, then re-issues the
 * owner_{slug} httpOnly cookie so they can access the inbox from any device.
 * Redirects to the inbox on success.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  // Verify the user owns this room
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, owner_token, user_id")
    .eq("slug", slug)
    .single();

  if (!room || room.user_id !== user.id) {
    redirect("/my-rooms");
  }

  // Re-issue the owner cookie so inbox access works on this device
  const cookieStore = await cookies();
  cookieStore.set(`owner_${slug}`, room.owner_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  redirect(`/${slug}/inbox`);
}
