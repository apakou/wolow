/**
 * Hybrid decryption: unwrap AES key with RSA private key, then decrypt
 * the AES-GCM ciphertext.
 *
 * Throws `DecryptError` (see ./decrypt-errors.ts) so callers can render
 * structured, actionable error UI.
 */

import type { EncryptedEnvelope } from "./encrypt-message";
import { DecryptError } from "./decrypt-errors";

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
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(encryptedPayload);
  } catch {
    throw new DecryptError("bad_envelope", "Encrypted payload is not valid JSON");
  }

  if (envelope.v !== 1) {
    throw new DecryptError("bad_envelope", `Unsupported encryption version: ${envelope.v}`);
  }

  if (!envelope.keys || !envelope.keys[role]) {
    throw new DecryptError("wrong_role", `Envelope has no wrapped key for role "${role}"`);
  }

  // 1. Import RSA private key
  let rsaPrivateKey: CryptoKey;
  try {
    rsaPrivateKey = await crypto.subtle.importKey(
      "jwk",
      privateKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );
  } catch (err) {
    throw new DecryptError("no_key", `Failed to import private key: ${(err as Error).message}`);
  }

  // 2. Unwrap AES key — failure here almost always means the message was
  // encrypted with a *different* public key than the one matching our private
  // key, i.e. the owner rotated keys after this message was sent.
  const wrappedKey = base64ToBuffer(envelope.keys[role]);
  let rawAesKey: ArrayBuffer;
  try {
    rawAesKey = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      rsaPrivateKey,
      wrappedKey,
    );
  } catch {
    throw new DecryptError(
      "key_rotated",
      "Could not unwrap AES key — message was likely encrypted with an older key",
    );
  }

  // 3. Import AES key
  const aesKey = await crypto.subtle.importKey(
    "raw",
    rawAesKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  // 4. Decrypt ciphertext
  const iv = new Uint8Array(base64ToBuffer(envelope.iv));
  const ciphertext = base64ToBuffer(envelope.ct);
  let plainBuffer: ArrayBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext,
    );
  } catch {
    throw new DecryptError("bad_envelope", "AES-GCM decryption failed (corrupted ciphertext)");
  }

  return new TextDecoder().decode(plainBuffer);
}
