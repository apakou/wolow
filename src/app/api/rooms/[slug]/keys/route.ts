import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { fingerprintPublicKey } from "@/lib/crypto/fingerprint";

type Params = { params: Promise<{ slug: string }> };

async function getRoom(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rooms")
    .select("id, owner_token, owner_public_key, owner_key_fingerprint, user_id")
    .eq("slug", slug)
    .single();
  return data ?? null;
}

/**
 * GET /api/rooms/[slug]/keys?conversation_id=...
 *
 * Returns both the owner's and visitor's public keys for a conversation.
 * No auth required — public keys are public by definition.
 */
export async function GET(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
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
  });
}

/**
 * PUT /api/rooms/[slug]/keys
 *
 * Sets or rotates the owner's public key. Requires the signed-in owner
 * (auth.uid() must match rooms.user_id).
 *
 * Contract (see src/lib/crypto/upload-public-key.ts):
 *   body    { public_key: JWK, fingerprint?: string, force_rotate?: boolean }
 *   200     { ok: true, fingerprint, rotated }
 *   200     idempotent re-upload of the key the server already holds
 *   409     { error, server_fingerprint } — server holds a DIFFERENT key and
 *           force_rotate wasn't set; client shows the restore-backup UI
 *   429     force_rotate rate limited (LIMITS.rotateKey per user)
 */
export async function PUT(req: Request, { params }: Params) {
  const { slug } = await params;
  const room = await getRoom(slug);
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

  const { public_key: publicKey, force_rotate: forceRotate } =
    body as { public_key?: unknown; force_rotate?: unknown };
  if (!publicKey || typeof publicKey !== "object" || Array.isArray(publicKey)) {
    return NextResponse.json({ error: "public_key is required" }, { status: 422 });
  }

  // Fingerprint is derived server-side from the submitted key — never trust
  // the client's value for storage or comparison.
  let fingerprint: string;
  try {
    fingerprint = await fingerprintPublicKey(publicKey as JsonWebKey);
  } catch {
    return NextResponse.json({ error: "public_key is not a valid RSA JWK" }, { status: 422 });
  }

  const hasExistingKey = Boolean(room.owner_public_key);
  let rotated = false;

  if (hasExistingKey) {
    // Legacy rows (pre-026) have no stored fingerprint — compute from the key.
    const serverFingerprint =
      room.owner_key_fingerprint ??
      (await fingerprintPublicKey(room.owner_public_key as JsonWebKey).catch(() => null));

    if (fingerprint === serverFingerprint && forceRotate !== true) {
      // Same key re-uploaded (e.g. inbox init on a device that already has it).
      return NextResponse.json({ ok: true, fingerprint, rotated: false });
    }

    if (forceRotate !== true) {
      // Different key and no explicit rotation: refuse, or the owner would
      // silently diverge from the key visitors are encrypting to.
      return NextResponse.json(
        { error: "Server already has a different owner key", server_fingerprint: serverFingerprint },
        { status: 409 }
      );
    }

    const rate = checkRateLimit(`rotate-key:${user.id}`, LIMITS.rotateKey.limit, LIMITS.rotateKey.windowMs);
    if (!rate.ok) {
      return NextResponse.json(
        { error: "Too many key rotations. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }
    rotated = fingerprint !== serverFingerprint;
  }

  // All 5 args named explicitly: uniquely selects the 5-param overload of the
  // RPC (migration 026). A 3-arg call is ambiguous while the legacy 019/025
  // signature still exists (PGRST203) — see migration 028.
  const { data: success, error } = await supabase.rpc("set_owner_public_key", {
    p_room_id: room.id,
    p_owner_token: room.owner_token,
    p_public_key: publicKey,
    p_fingerprint: fingerprint,
    p_mark_rotated: rotated,
  });

  if (error || success !== true) {
    logError({
      message: error?.message ?? "set_owner_public_key matched no row",
      endpoint: `/api/rooms/${slug}/keys`,
      method: "PUT",
      statusCode: 500,
      slug,
    });
    return NextResponse.json({ error: "Failed to store key" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fingerprint, rotated }, { status: 200 });
}
