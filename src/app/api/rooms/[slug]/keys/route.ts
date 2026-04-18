import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";
import { checkRateLimit, getClientIp, LIMITS } from "@/lib/rate-limit";
import { fingerprintPublicKey } from "@/lib/crypto/fingerprint";

type Params = { params: Promise<{ slug: string }> };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, owner_token, owner_public_key, user_id, owner_key_fingerprint, owner_public_key_rotated_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    logError({
      message: `getRoom failed: ${error.message}`,
      endpoint: `/api/rooms/${slug}/keys`,
      method: "GET",
      statusCode: 500,
      slug,
    });
    return { __error: error.message } as const;
  }
  return data ?? null;
}

/**
 * GET /api/rooms/[slug]/keys?conversation_id=...
 *
 * Returns both the owner's and visitor's public keys for a conversation,
 * plus key metadata (fingerprint, last rotated). No auth required — public
 * keys are public by definition.
 */
export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (room && "__error" in room) {
    return NextResponse.json({ error: "Database error", detail: room.__error }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");

  let visitorPublicKey = null;
  if (conversationId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("conversations")
      .select("visitor_public_key")
      .eq("id", conversationId)
      .eq("room_id", room.id)
      .single();
    visitorPublicKey = data?.visitor_public_key ?? null;
  }

  return NextResponse.json({
    owner_public_key: room.owner_public_key ?? null,
    visitor_public_key: visitorPublicKey,
    owner_key_fingerprint: room.owner_key_fingerprint ?? null,
    owner_public_key_rotated_at: room.owner_public_key_rotated_at ?? null,
  });
}

/**
 * PUT /api/rooms/[slug]/keys
 *
 * Sets / rotates the owner's public key. Requires Supabase auth and that the
 * caller owns the room (`rooms.user_id`).
 *
 * Body:
 *  - public_key (JsonWebKey, required) — the RSA-OAEP public key
 *  - fingerprint (string, optional) — must match server-recomputed value
 *  - force_rotate (boolean, optional) — set true when intentionally replacing
 *    a previously-stored key (e.g. user restored from backup). Subject to
 *    the rotateKey rate limit.
 */
export async function PUT(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
  if (room && "__error" in room) {
    return NextResponse.json({ error: "Database error", detail: room.__error }, { status: 500 });
  }
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== room.user_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodyObj = body as Record<string, unknown>;
  const publicKey = bodyObj.public_key;
  const clientFingerprint = typeof bodyObj.fingerprint === "string" ? bodyObj.fingerprint : null;
  const forceRotate = bodyObj.force_rotate === true;

  if (!publicKey || typeof publicKey !== "object") {
    return NextResponse.json({ error: "public_key is required" }, { status: 422 });
  }

  // Validate fingerprint if supplied — protects against silent corruption.
  let serverFingerprint: string;
  try {
    serverFingerprint = await fingerprintPublicKey(publicKey as JsonWebKey);
  } catch {
    return NextResponse.json({ error: "Invalid public key" }, { status: 422 });
  }
  if (clientFingerprint && clientFingerprint !== serverFingerprint) {
    return NextResponse.json(
      { error: "Fingerprint mismatch — refusing to store" },
      { status: 422 },
    );
  }

  // Rate-limit forced rotations (per-user) to prevent abuse / accidental loops.
  if (forceRotate) {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`rotate-key:${user.id}:${ip}`, LIMITS.rotateKey.limit, LIMITS.rotateKey.windowMs);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many key rotations — try again later", retry_after: rl.retryAfter },
        { status: 429 },
      );
    }
  }

  // Skip the RPC when the incoming key is identical to what we already have —
  // common path on every inbox load. Avoids touching `rotated_at`.
  const existing = room.owner_public_key as JsonWebKey | null;
  const isSameKey =
    !!existing && existing.n === (publicKey as JsonWebKey).n && existing.e === (publicKey as JsonWebKey).e;
  const isRotation = !isSameKey && !!existing;

  // Refuse silent rotation: if the server already has a different key and the
  // caller did not explicitly opt in via force_rotate, return 409. This prevents
  // a second device (or a browser with cleared IndexedDB) from silently
  // replacing the owner's real key and orphaning previously-encrypted messages.
  if (isRotation && !forceRotate) {
    return NextResponse.json(
      {
        error: "key_conflict",
        message:
          "Server already has a different owner key. Restore your backup, or pass force_rotate=true to replace it (this will make all previous messages permanently unreadable).",
        server_fingerprint: room.owner_key_fingerprint ?? null,
      },
      { status: 409 },
    );
  }

  if (!isSameKey) {
    const { error } = await supabase.rpc("set_owner_public_key", {
      p_room_id: room.id,
      p_owner_token: room.owner_token,
      p_public_key: publicKey,
      p_fingerprint: serverFingerprint,
      p_mark_rotated: isRotation,
    });

    if (error) {
      logError({ message: error.message, endpoint: `/api/rooms/${slug}/keys`, method: "PUT", statusCode: 500, slug });
      return NextResponse.json({ error: "Failed to store key" }, { status: 500 });
    }
  } else if (room.owner_key_fingerprint !== serverFingerprint) {
    // Key matches but fingerprint metadata is stale (pre-migration data) — backfill via RPC.
    await supabase.rpc("set_owner_public_key", {
      p_room_id: room.id,
      p_owner_token: room.owner_token,
      p_public_key: publicKey,
      p_fingerprint: serverFingerprint,
      p_mark_rotated: false,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      fingerprint: serverFingerprint,
      rotated: isRotation,
    },
    { status: 200 },
  );
}
