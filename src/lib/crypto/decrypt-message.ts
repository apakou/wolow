/**
 * Hybrid decryption: unwrap AES key with RSA private key, then decrypt
 * the AES-GCM ciphertext.
 */

import type { EncryptedEnvelope } from "./encrypt-message";

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function decryptMessage(
  encryptedPayload: string,
  privateKey: JsonWebKey,
  role: "owner" | "visitor",
): Promise<string> {
  const envelope: EncryptedEnvelope = JSON.parse(encryptedPayload);

  if (envelope.v !== 1) {
    throw new Error(`Unsupported encryption version: ${envelope.v}`);
  }

  // 1. Import RSA private key
  const rsaPrivateKey = await crypto.subtle.importKey(
    "jwk",
    privateKey,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );

  // 2. Unwrap AES key
  const wrappedKey = base64ToBuffer(envelope.keys[role]);
  const rawAesKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    rsaPrivateKey,
    wrappedKey
  );

  // 3. Import AES key
  const aesKey = await crypto.subtle.importKey(
    "raw",
    rawAesKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // 4. Decrypt ciphertext
  const iv = new Uint8Array(base64ToBuffer(envelope.iv));
  const ciphertext = base64ToBuffer(envelope.ct);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  return new TextDecoder().decode(plainBuffer);
}
