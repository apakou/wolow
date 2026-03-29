import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Body = { slug: string; role?: "sender" | "owner" };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 422 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const role = body.role === "owner" ? "owner" : "sender";
  const cookieStore = await cookies();

  if (role === "owner") {
    const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
    if (!ownerToken) return NextResponse.json({ ok: true, claimed: 0 });

    const { data, error } = await supabase.rpc("claim_room", {
      p_slug: slug,
      p_owner_token: ownerToken,
    });

    if (error) {
      return NextResponse.json({ error: "Failed to claim room" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, claimed: Array.isArray(data) ? data.length : 0 });
  }

  const senderToken = cookieStore.get(`sender_${slug}`)?.value;
  if (!senderToken) return NextResponse.json({ ok: true, claimed: 0 });

  const { data, error } = await supabase.rpc("claim_conversation", {
    p_sender_token: senderToken,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to claim conversations" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, claimed: Array.isArray(data) ? data.length : 0 });
}
