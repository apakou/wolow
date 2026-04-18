/**
 * Structured decryption errors so the UI can render contextual help.
 *
 * Reasons:
 *  - `no_key`       — local private key missing (cleared data, new device)
 *  - `key_rotated`  — message was encrypted with a different key (likely a
 *                     previous owner key before the user restored a new one)
 *  - `bad_envelope` — envelope JSON malformed or unsupported version
 *  - `wrong_role`   — envelope doesn't contain a wrapped key for our role
 *  - `unknown`      — anything else (network, browser quirks)
 */

export type DecryptErrorReason =
  | "no_key"
  | "key_rotated"
  | "bad_envelope"
  | "wrong_role"
  | "unknown";

export class DecryptError extends Error {
  readonly reason: DecryptErrorReason;

  constructor(reason: DecryptErrorReason, message: string) {
    super(message);
    this.name = "DecryptError";
    this.reason = reason;
  }
}

export function isDecryptError(value: unknown): value is DecryptError {
  return value instanceof DecryptError;
}
