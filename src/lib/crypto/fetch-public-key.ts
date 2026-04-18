/**
 * Fetches the E2EE public keys for a room/conversation via the API.
 */

export interface ConversationKeys {
  ownerPublicKey: JsonWebKey | null;
  visitorPublicKey: JsonWebKey | null;
}

export class FetchKeysError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FetchKeysError";
    this.status = status;
  }
}

export async function fetchConversationKeys(
  slug: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationKeys> {
  const res = await fetch(
    `/api/rooms/${slug}/keys?conversation_id=${encodeURIComponent(conversationId)}`,
    { signal },
  );

  if (!res.ok) {
    throw new FetchKeysError(res.status, `Failed to fetch public keys (HTTP ${res.status})`);
  }

  const data = await res.json();
  return {
    ownerPublicKey: data.owner_public_key ?? null,
    visitorPublicKey: data.visitor_public_key ?? null,
  };
}
