import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeCompare } from "@/lib/safe-compare";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  console.info("[room-delete-api] start", { slug });
  const supabase = await createClient();

  // Get the room to authorize
  const { data: room } = await supabase
    .from("rooms")
    .select("id, user_id, owner_token")
    .eq("slug", slug)
    .single();

  if (!room) {
    console.warn("[room-delete-api] room-not-found", { slug });
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Authorize using either linked account or legacy owner cookie.
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authorizedByToken = !!ownerToken && safeCompare(ownerToken, room.owner_token);
  const authorizedByUser = !!user && !!room.user_id && user.id === room.user_id;

  if (!authorizedByToken && !authorizedByUser) {
    console.warn("[room-delete-api] unauthorized", {
      slug,
      roomId: room.id,
      hasOwnerCookie: !!ownerToken,
      hasUser: !!user,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Archive via SECURITY DEFINER RPC so soft-delete is not blocked by RLS.
  // For account-based ownership we use the stored room token after route-level auth.
  const tokenForArchive = authorizedByUser ? room.owner_token : ownerToken;

  const { data, error } = await supabase.rpc("archive_room_by_slug", {
    p_slug: slug,
    p_owner_token: tokenForArchive,
  });

  if (error) {
    console.error("[room-delete-api] archive-rpc-error", {
      slug,
      roomId: room.id,
      error: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    console.warn("[room-delete-api] archive-rpc-false", {
      slug,
      roomId: room.id,
      authorizedByUser,
      authorizedByToken,
    });
    return NextResponse.json({ error: "Room could not be archived" }, { status: 403 });
  }

  console.info("[room-delete-api] archived", {
    slug,
    roomId: room.id,
    authorizedByUser,
    authorizedByToken,
  });
  return NextResponse.json({ ok: true, archived: true, room_id: room.id });
}
