/**
 * Human-readable fingerprints for RSA public keys.
 *
 * Computed as SHA-256 over the canonical JWK (n + e), then mapped to a
 * 4-word Wolow-themed phrase like "sunny-otter-velvet-comet".
 *
 * Wordlist size ≈ 24 × 24 × 24 × 24 = 331,776 combinations (~18 bits).
 * This is NOT a cryptographic identifier — only a friendly string for humans
 * to compare ("does my local key match the server's?"). Collisions are
 * acceptable here because the underlying SHA-256 hash is the source of truth
 * we'd actually verify against if we needed certainty.
 */

import { ADJECTIVES, CREATURES, NOUNS, VERBS } from "./fingerprint-wordlist";

/** Compute SHA-256 hex of an RSA public JWK's `n` + `e` fields. */
async function hashPublicKey(jwk: JsonWebKey): Promise<Uint8Array> {
  if (!jwk.n || !jwk.e) {
    throw new Error("Invalid public JWK: missing n or e");
  }
  const canonical = `${jwk.n}|${jwk.e}`;
  const bytes = new TextEncoder().encode(canonical);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return new Uint8Array(digest);
}

/** Picks an item from `list` using `bytes` starting at `offset` (2 bytes per pick). */
function pickWord(list: readonly string[], bytes: Uint8Array, offset: number): string {
  const idx = ((bytes[offset] << 8) | bytes[offset + 1]) % list.length;
  return list[idx];
}

/**
 * Generate a 4-word fingerprint from an RSA public JWK.
 * Format: `{adjective}-{creature}-{noun}-{verb}` e.g. `sunny-otter-velvet-soars`.
 */
export async function fingerprintPublicKey(jwk: JsonWebKey): Promise<string> {
  const hash = await hashPublicKey(jwk);
  const adj = pickWord(ADJECTIVES, hash, 0);
  const creature = pickWord(CREATURES, hash, 2);
  const noun = pickWord(NOUNS, hash, 4);
  const verb = pickWord(VERBS, hash, 6);
  return `${adj}-${creature}-${noun}-${verb}`.toLowerCase();
}

/** Derive a public JWK from a private RSA-OAEP JWK (strips private fields). */
export function publicJwkFromPrivate(privateJwk: JsonWebKey): JsonWebKey {
  return {
    kty: privateJwk.kty,
    n: privateJwk.n,
    e: privateJwk.e,
    alg: privateJwk.alg,
    ext: true,
    key_ops: ["encrypt"],
  };
}
