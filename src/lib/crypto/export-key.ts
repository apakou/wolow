/**
 * Export an RSA private key as a passphrase-encrypted `.wolow-key` blob.
 *
 * Format (JSON, version 1):
 * {
 *   v: 1,
 *   kdf: "PBKDF2-SHA256",
 *   iter: 600000,
 *   salt: base64(16 bytes),
 *   iv: base64(12 bytes),
 *   ct: base64(AES-GCM ciphertext over JSON.stringify(privateJwk)),
 *   fingerprint: "four-word-phrase",
 *   slug: "owner-room-slug",
 *   created_at: ISO8601
 * }
 *
 * The passphrase never leaves the browser. Wolow servers never see this file.
 */

import { fingerprintPublicKey, publicJwkFromPrivate } from "./fingerprint";

export const WOLOW_KEY_VERSION = 1 as const;
export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface WolowKeyFile {
  v: typeof WOLOW_KEY_VERSION;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  fingerprint: string;
  slug: string;
  created_at: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a private JWK with a passphrase and return a Blob ready to download.
 *
 * @throws if `passphrase.length < 12` (basic guard — UI should enforce too)
 */
export async function exportWrappedKey(
  privateJwk: JsonWebKey,
  passphrase: string,
  slug: string,
): Promise<{ blob: Blob; filename: string; fingerprint: string }> {
  if (passphrase.length < 12) {
    throw new Error("Passphrase must be at least 12 characters");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)) as Uint8Array<ArrayBuffer>;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES)) as Uint8Array<ArrayBuffer>;
  const aesKey = await deriveKey(passphrase, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify(privateJwk));
  const ctBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);

  const fingerprint = await fingerprintPublicKey(publicJwkFromPrivate(privateJwk));

  const file: WolowKeyFile = {
    v: WOLOW_KEY_VERSION,
    kdf: "PBKDF2-SHA256",
    iter: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ctBuffer)),
    fingerprint,
    slug,
    created_at: new Date().toISOString(),
  };

  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `wolow-${slug}-${stamp}.wolow-key`;

  return { blob, filename, fingerprint };
}
