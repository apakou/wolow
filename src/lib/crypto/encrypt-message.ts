/**
 * Hybrid encryption: AES-256-GCM for the payload, RSA-OAEP for key wrapping.
 * Encrypts once, wraps the AES key for both the owner and the visitor so
 * either party can decrypt.
 */

export interface EncryptedEnvelope {
  v: 1;
  ct: string;  // base64 AES-GCM ciphertext (includes GCM auth tag)
  iv: string;  // base64 12-byte IV
  keys: {
    owner: string;   // base64 RSA-wrapped AES key
    visitor: string; // base64 RSA-wrapped AES key
  };
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function importRsaPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

export async function encryptMessage(
  plaintext: string,
  ownerPublicKey: JsonWebKey,
  visitorPublicKey: JsonWebKey,
): Promise<string> {
  // 1. Generate ephemeral AES-256-GCM key
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );

  // 2. Random 12-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 3. Encrypt plaintext with AES-GCM
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoded
  );

  // 4. Export raw AES key for wrapping
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);

  // 5. Wrap AES key with both RSA public keys
  const [ownerCryptoKey, visitorCryptoKey] = await Promise.all([
    importRsaPublicKey(ownerPublicKey),
    importRsaPublicKey(visitorPublicKey),
  ]);

  const [wrappedForOwner, wrappedForVisitor] = await Promise.all([
    crypto.subtle.encrypt({ name: "RSA-OAEP" }, ownerCryptoKey, rawAesKey),
    crypto.subtle.encrypt({ name: "RSA-OAEP" }, visitorCryptoKey, rawAesKey),
  ]);

  // 6. Build envelope
  const envelope: EncryptedEnvelope = {
    v: 1,
    ct: bufferToBase64(cipherBuffer),
    iv: bufferToBase64(iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength)),
    keys: {
      owner: bufferToBase64(wrappedForOwner),
      visitor: bufferToBase64(wrappedForVisitor),
    },
  };

  return JSON.stringify(envelope);
}
