/**
 * Generates an RSA-OAEP key pair for E2E encryption/decryption.
 * Uses the Web Crypto API — runs only in browser contexts.
 */

export interface ExportedKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

const KEY_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]), // 65537
  hash: "SHA-256",
};

const KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt"];

export async function generateKeyPair(): Promise<ExportedKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    KEY_PARAMS,
    true, // extractable — required to export as JWK
    KEY_USAGES
  );

  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", keyPair.publicKey),
    crypto.subtle.exportKey("jwk", keyPair.privateKey),
  ]);

  return { publicKey, privateKey };
}
