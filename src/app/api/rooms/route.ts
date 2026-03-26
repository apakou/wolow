import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getClientIp, LIMITS } from "@/lib/rate-limit";
import { checkRateLimitDb } from "@/lib/rate-limit-db";
import { logSecurityEvent } from "@/lib/security-logger";

export async function POST(request: Request) {
  // Rate limit: 5 room creations per IP per hour (DB-backed, cross-instance)
  const ip = getClientIp(request);
  const rl = await checkRateLimitDb(`create-room:${ip}`, LIMITS.createRoom.limit, LIMITS.createRoom.windowMs);
  if (!rl.ok) {
    logSecurityEvent("rate_limit_hit", { endpoint: "create-room", ip, retryAfter: rl.retryAfter });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawName =
    typeof (body as Record<string, unknown>).display_name === "string"
      ? ((body as Record<string, unknown>).display_name as string).trim()
      : "";

  if (rawName.length > 50) {
    return NextResponse.json(
      { error: "display_name must be 50 characters or fewer" },
      { status: 422 }
    );
  }

  const slug = nanoid(10);
  const owner_token = crypto.randomUUID();
  const display_name = rawName || "Anonymous";

  const supabase = await createClient();
  const { error } = await supabase
    .from("rooms")
    .insert({ slug, owner_token, display_name });

  if (error) {
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }

  const cookieStore = await cookies();
  cookieStore.set(`owner_${slug}`, owner_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return NextResponse.json({ slug }, { status: 201 });
}
