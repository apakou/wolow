import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();

  let claimedRooms = 0;
  let claimedConversations = 0;

  for (const cookie of allCookies) {
    if (cookie.name.startsWith("owner_")) {
      const slug = cookie.name.slice("owner_".length);
      if (!slug || !cookie.value) continue;
      const { data } = await supabase.rpc("claim_room", {
        p_slug: slug,
        p_owner_token: cookie.value,
      });
      claimedRooms += Array.isArray(data) ? data.length : 0;
      continue;
    }

    if (cookie.name.startsWith("sender_") && cookie.value) {
      const { data } = await supabase.rpc("claim_conversation", {
        p_sender_token: cookie.value,
      });
      claimedConversations += Array.isArray(data) ? data.length : 0;
    }
  }

  return NextResponse.json({
    ok: true,
    claimedRooms,
    claimedConversations,
  });
}