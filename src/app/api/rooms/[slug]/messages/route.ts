import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";

type Params = { params: Promise<{ slug: string }> };

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, content, is_owner, created_at")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params;

  // Rate limit: 10 messages per IP per minute
  const ip = getClientIp(req);
  const rl = checkRateLimit(`send-message:${ip}`, LIMITS.sendMessage.limit, LIMITS.sendMessage.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many messages. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof (body as Record<string, unknown>).content === "string"
      ? ((body as Record<string, unknown>).content as string).trim()
      : "";

  const content = stripHtml(raw).trim();

  if (content.length < 1) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 422 });
  }
  if (content.length > 1000) {
    return NextResponse.json(
      { error: "Message must be 1000 characters or fewer" },
      { status: 422 }
    );
  }

  const room = await getRoom(slug);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Determine if the sender is the room owner via httpOnly cookie
  const cookieStore = await cookies();
  const ownerToken = cookieStore.get(`owner_${slug}`)?.value;
  const is_owner = !!ownerToken && ownerToken === room.owner_token;

  const supabase = await createClient();
  const { error } = await supabase
    .from("messages")
    .insert({ room_id: room.id, content, is_owner });

  if (error) {
    console.error("[messages] insert error:", error.message);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
