/**
 * Import a `.wolow-key` backup file: decrypt the wrapped private JWK with a
 * passphrase and (optionally) write it to IndexedDB at `room:{slug}`.
 *
 * Throws structured errors so the UI can show actionable messages:
 *  - `bad_format`     — file isn't a valid Wolow key file
 *  - `version`        — unknown file version
 *  - `slug_mismatch`  — file is for a different room
 *  - `bad_passphrase` — decryption failed (wrong passphrase or corrupted file)
 */

import { fingerprintPublicKey, publicJwkFromPrivate } from "./fingerprint";
import { storePrivateKey } from "./key-storage";
import { type WolowKeyFile, WOLOW_KEY_VERSION } from "./export-key";

export type ImportErrorReason =
  | "bad_format"
  | "version"
  | "slug_mismatch"
  | "bad_passphrase";

export class ImportKeyError extends Error {
  constructor(public reason: ImportErrorReason, message: string) {
    super(message);
    this.name = "ImportKeyError";
  }
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isWolowKeyFile(value: unknown): value is WolowKeyFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === "number" &&
    typeof v.kdf === "string" &&
    typeof v.iter === "number" &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    typeof v.ct === "string" &&
    typeof v.slug === "string"
  );
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

export interface ImportResult {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  fingerprint: string;
  slug: string;
}

/**
 * Decrypt a `.wolow-key` file and return the private JWK plus metadata.
 * Does NOT write to IndexedDB — call `writeImportedKey()` separately so the
 * caller can confirm fingerprint match against the server first.
 */
export async function importWrappedKey(
  fileText: string,
  passphrase: string,
  expectedSlug: string,
): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new ImportKeyError("bad_format", "File is not valid JSON");
  }

  if (!isWolowKeyFile(parsed)) {
    throw new ImportKeyError("bad_format", "File is not a Wolow key backup");
  }

  if (parsed.v !== WOLOW_KEY_VERSION) {
    throw new ImportKeyError("version", `Unsupported backup version: ${parsed.v}`);
  }

  if (parsed.slug !== expectedSlug) {
    throw new ImportKeyError(
      "slug_mismatch",
      `This backup is for "${parsed.slug}", not "${expectedSlug}"`,
    );
  }

  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const ct = base64ToBytes(parsed.ct);
  const aesKey = await deriveKey(passphrase, salt, parsed.iter);

  let plainBuffer: ArrayBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  } catch {
    throw new ImportKeyError("bad_passphrase", "Wrong passphrase or corrupted file");
  }

  let privateJwk: JsonWebKey;
  try {
    privateJwk = JSON.parse(new TextDecoder().decode(plainBuffer)) as JsonWebKey;
  } catch {
    throw new ImportKeyError("bad_format", "Decrypted contents are not a valid key");
  }

  const publicJwk = publicJwkFromPrivate(privateJwk);
  const fingerprint = await fingerprintPublicKey(publicJwk);

  return { privateJwk, publicJwk, fingerprint, slug: parsed.slug };
}

/** Persist an already-decrypted JWK to IndexedDB at `room:{slug}`. */
export async function writeImportedKey(slug: string, privateJwk: JsonWebKey): Promise<void> {
  await storePrivateKey(`room:${slug}`, privateJwk);
}
