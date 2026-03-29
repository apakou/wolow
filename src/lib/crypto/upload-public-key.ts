/**
 * Uploads a public key to the server.
 *
 * Owner:   PUT /api/rooms/{slug}/keys  (requires owner cookie)
 * Visitor: PUT /api/rooms/{slug}/conversations/keys  (requires sender cookie)
 */

export async function uploadOwnerPublicKey(
  slug: string,
  publicKey: JsonWebKey,
): Promise<void> {
  const res = await fetch(`/api/rooms/${slug}/keys`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to upload public key");
  }
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
