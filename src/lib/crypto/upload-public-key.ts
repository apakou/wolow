/**
 * Uploads a public key to the server.
 *
 * Owner:   PUT /api/rooms/{slug}/keys           (requires Supabase auth)
 * Visitor: PUT /api/rooms/{slug}/conversations/keys (requires sender cookie)
 */

import { fingerprintPublicKey } from "./fingerprint";

export interface UploadOwnerKeyOptions {
  /** True when intentionally replacing the server-stored key (e.g. backup restore). */
  forceRotate?: boolean;
}

export interface UploadOwnerKeyResult {
  ok: true;
  fingerprint: string;
  rotated: boolean;
}

/**
 * Thrown when the server already holds a different owner public key and the
 * caller did not pass forceRotate. Callers should surface a "restore your
 * backup" UI rather than silently overwriting the server key.
 */
export class OwnerKeyConflictError extends Error {
  readonly serverFingerprint: string | null;
  readonly localFingerprint: string;
  constructor(localFingerprint: string, serverFingerprint: string | null) {
    super("Server already has a different owner key");
    this.name = "OwnerKeyConflictError";
    this.localFingerprint = localFingerprint;
    this.serverFingerprint = serverFingerprint;
  }
}

export async function uploadOwnerPublicKey(
  slug: string,
  publicKey: JsonWebKey,
  options: UploadOwnerKeyOptions = {},
): Promise<UploadOwnerKeyResult> {
  const fingerprint = await fingerprintPublicKey(publicKey);
  const res = await fetch(`/api/rooms/${slug}/keys`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      public_key: publicKey,
      fingerprint,
      force_rotate: options.forceRotate === true,
    }),
  });

  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as { server_fingerprint?: string | null };
    throw new OwnerKeyConflictError(fingerprint, data.server_fingerprint ?? null);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to upload public key");
  }

  const data = (await res.json().catch(() => ({}))) as Partial<UploadOwnerKeyResult>;
  return {
    ok: true,
    fingerprint: data.fingerprint ?? fingerprint,
    rotated: data.rotated === true,
  };
}

export async function uploadVisitorPublicKey(
  slug: string,
  conversationId: string,
  publicKey: JsonWebKey,
): Promise<void> {
  const res = await fetch(`/api/rooms/${slug}/conversations/keys`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, public_key: publicKey }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to upload public key");
  }
}
