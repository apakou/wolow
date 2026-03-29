/**
 * Fetches the E2EE public keys for a room/conversation via the API.
 */

export interface ConversationKeys {
  ownerPublicKey: JsonWebKey | null;
  visitorPublicKey: JsonWebKey | null;
}

export async function fetchConversationKeys(
  slug: string,
  conversationId: string,
): Promise<ConversationKeys> {
  const res = await fetch(
    `/api/rooms/${slug}/keys?conversation_id=${encodeURIComponent(conversationId)}`,
  );

  if (!res.ok) {
    throw new Error("Failed to fetch public keys");
  }

  const data = await res.json();
  return {
    ownerPublicKey: data.owner_public_key ?? null,
    visitorPublicKey: data.visitor_public_key ?? null,
  };
}
