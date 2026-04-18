"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateKeyPair } from "@/lib/crypto/generate-key-pair";
import { storePrivateKey, getPrivateKey } from "@/lib/crypto/key-storage";
import { uploadOwnerPublicKey, uploadVisitorPublicKey, OwnerKeyConflictError } from "@/lib/crypto/upload-public-key";
import { fetchConversationKeys, FetchKeysError, type ConversationKeys } from "@/lib/crypto/fetch-public-key";
import { encryptMessage } from "@/lib/crypto/encrypt-message";
import { decryptMessage } from "@/lib/crypto/decrypt-message";
import { DecryptError } from "@/lib/crypto/decrypt-errors";

interface UseE2EEOptions {
  slug: string;
  conversationId: string | undefined;
  isOwnerView: boolean;
}

interface E2EEState {
  ready: boolean;
  encrypting: boolean;
  error: string | null;
  /** True once the local private key is confirmed in IndexedDB (loaded or generated) */
  keyLoaded: boolean;
  /** True when the server has an owner public key for this room */
  ownerKeyOnServer: boolean;
  /** True when the server has a visitor public key for this conversation */
  visitorKeyOnServer: boolean;
}

export function useE2EE({ slug, conversationId, isOwnerView }: UseE2EEOptions) {
  const [state, setState] = useState<E2EEState>({
    ready: false,
    encrypting: false,
    error: null,
    keyLoaded: false,
    ownerKeyOnServer: false,
    visitorKeyOnServer: false,
  });

  const keysRef = useRef<ConversationKeys | null>(null);
  const myKeyIdRef = useRef<string | null>(null);
  const roleRef = useRef<"owner" | "visitor">(isOwnerView ? "owner" : "visitor");
  const lastConvRef = useRef<string | null>(null);

  // Initialize keys on mount (and re-init when conversationId changes)
  useEffect(() => {
    if (!conversationId) return;
    // Web Crypto API requires a secure context (HTTPS or localhost)
    if (typeof crypto === "undefined" || !crypto.subtle) {
      setState({ ready: false, encrypting: false, error: "E2EE unavailable (requires HTTPS)", keyLoaded: false, ownerKeyOnServer: false, visitorKeyOnServer: false });
      return;
    }
    if (lastConvRef.current === conversationId) return;
    lastConvRef.current = conversationId;
    roleRef.current = isOwnerView ? "owner" : "visitor";

    const keyId = isOwnerView ? `room:${slug}` : `conv:${conversationId}`;
    myKeyIdRef.current = keyId;

    (async () => {
      try {
        // 1. Fetch server-side keys first so we know what's already published.
        //    This avoids the silent-rotation footgun: if the server already has
        //    an owner key but our IndexedDB is empty (new device / cleared data),
        //    we must NOT generate a new pair — that would orphan prior messages.
        //    Retry once on transient failure; if still failing, check for an
        //    existing local key before deciding how to degrade.
        let serverKeys: ConversationKeys | null = null;
        let serverFetchError: unknown = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            serverKeys = await fetchConversationKeys(slug, conversationId);
            serverFetchError = null;
            break;
          } catch (err) {
            serverFetchError = err;
            // Retry on 5xx or network errors; don't retry on 404 (room doesn't exist).
            if (err instanceof FetchKeysError && err.status === 404) break;
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        // 2. Check if we already have a private key locally.
        let existingPrivateKey = await getPrivateKey(keyId);

        if (!serverKeys) {
          // Couldn't reach the server. Don't silently generate (risk of
          // orphaning future messages if the server actually has a key).
          // If we already have a local key, proceed with decrypt-only state
          // so the user can at least read past messages.
          if (existingPrivateKey) {
            setState({
              ready: false,
              encrypting: false,
              error: null,
              keyLoaded: true,
              ownerKeyOnServer: false,
              visitorKeyOnServer: false,
            });
            return;
          }
          // No local key AND can't reach server: surface a retryable error.
          lastConvRef.current = null;
          const msg = serverFetchError instanceof Error ? serverFetchError.message : "Failed to fetch public keys";
          setState({
            ready: false,
            encrypting: false,
            error: msg,
            keyLoaded: false,
            ownerKeyOnServer: false,
            visitorKeyOnServer: false,
          });
          return;
        }

        // 3. If no local key, decide whether to generate.
        if (!existingPrivateKey) {
          const serverHasMyKey = isOwnerView ? !!serverKeys.ownerPublicKey : !!serverKeys.visitorPublicKey;
          if (isOwnerView && serverHasMyKey) {
            // Owner's real key is on another device — refuse to silently rotate.
            setState({
              ready: false,
              encrypting: false,
              error: "owner_key_missing_restore_required",
              keyLoaded: false,
              ownerKeyOnServer: !!serverKeys.ownerPublicKey,
              visitorKeyOnServer: !!serverKeys.visitorPublicKey,
            });
            return;
          }
          // Legit first-time: generate + upload.
          const { publicKey, privateKey } = await generateKeyPair();
          if (isOwnerView) {
            await uploadOwnerPublicKey(slug, publicKey);
          } else {
            await uploadVisitorPublicKey(slug, conversationId, publicKey);
          }
          await storePrivateKey(keyId, privateKey);
          existingPrivateKey = privateKey;
        }

        keysRef.current = serverKeys;

        // Private key is now confirmed in IndexedDB — signal early so
        // decryption can proceed even before the other party's key is fetched.
        setState((prev) => ({ ...prev, keyLoaded: true }));

        // 4. Re-fetch keys (in case we just uploaded ours).
        const keys = await fetchConversationKeys(slug, conversationId);
        keysRef.current = keys;

        // 5. Recovery: if our key exists locally but not on server, re-upload.
        //    For the owner, this is safe only if the server has NO key at all
        //    (server returns 409 if it has a different one, which we treat as
        //    "another device owns the server-side key — don't overwrite").
        const myKeyMissing = isOwnerView ? !keys.ownerPublicKey : !keys.visitorPublicKey;
        if (myKeyMissing && existingPrivateKey) {
          const publicJwk: JsonWebKey = {
            kty: existingPrivateKey.kty, n: existingPrivateKey.n, e: existingPrivateKey.e,
            alg: existingPrivateKey.alg, ext: true, key_ops: ["encrypt"],
          };
          try {
            if (isOwnerView) {
              await uploadOwnerPublicKey(slug, publicJwk);
            } else {
              await uploadVisitorPublicKey(slug, conversationId, publicJwk);
            }
            const refreshed = await fetchConversationKeys(slug, conversationId);
            keysRef.current = refreshed;
            keys.ownerPublicKey = refreshed.ownerPublicKey;
            keys.visitorPublicKey = refreshed.visitorPublicKey;
          } catch (err) {
            if (err instanceof OwnerKeyConflictError) {
              // Another device owns the server key. This device's local key
              // can't decrypt incoming messages — surface as restore-required.
              setState({
                ready: false,
                encrypting: false,
                error: "owner_key_conflict_restore_required",
                keyLoaded: true,
                ownerKeyOnServer: !!keys.ownerPublicKey,
                visitorKeyOnServer: !!keys.visitorPublicKey,
              });
              return;
            }
            throw err;
          }
        }

        // Ready if both parties have keys
        const bothReady = !!keys.ownerPublicKey && !!keys.visitorPublicKey;
        setState({
          ready: bothReady,
          encrypting: false,
          error: null,
          keyLoaded: true,
          ownerKeyOnServer: !!keys.ownerPublicKey,
          visitorKeyOnServer: !!keys.visitorPublicKey,
        });
      } catch (err) {
        console.error("[E2EE] Init error:", err);
        // Allow retry on next mount/conversationId change
        lastConvRef.current = null;
        setState({ ready: false, encrypting: false, error: (err as Error).message, keyLoaded: false, ownerKeyOnServer: false, visitorKeyOnServer: false });
      }
    })();
  }, [slug, conversationId, isOwnerView]);

  // Poll for the other party's key when not yet ready
  useEffect(() => {
    if (state.ready || !conversationId) return;
    const controller = new AbortController();
    const interval = setInterval(async () => {
      if (controller.signal.aborted) return;
      try {
        const keys = await fetchConversationKeys(slug, conversationId, controller.signal);
        if (controller.signal.aborted) return;
        keysRef.current = keys;
        if (keys.ownerPublicKey && keys.visitorPublicKey) {
          setState((prev) => ({ ...prev, ready: true, keyLoaded: true, ownerKeyOnServer: true, visitorKeyOnServer: true }));
        } else {
          setState((prev) => ({ ...prev, ownerKeyOnServer: !!keys.ownerPublicKey, visitorKeyOnServer: !!keys.visitorPublicKey }));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Suppress transient browser-cancelled network errors (navigation, tab hide, etc.)
        if (err instanceof TypeError && /failed to fetch|load failed/i.test((err as TypeError).message)) return;
        // Poll retries automatically — log at debug level only
        console.debug("[E2EE] Poll: key fetch failed, will retry", err);
      }
    }, 5_000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [state.ready, slug, conversationId]);

  // Refresh keys (called when we detect the other party has uploaded their key)
  const refreshKeys = useCallback(async () => {
    if (!conversationId) return;
    try {
      const keys = await fetchConversationKeys(slug, conversationId);
      keysRef.current = keys;
      const bothReady = !!keys.ownerPublicKey && !!keys.visitorPublicKey;
      setState((prev) => ({
        ...prev,
        ready: bothReady,
        keyLoaded: true,
        ownerKeyOnServer: !!keys.ownerPublicKey,
        visitorKeyOnServer: !!keys.visitorPublicKey,
      }));
    } catch {
      // Silent — we'll retry on next message
    }
  }, [slug, conversationId]);

  const encrypt = useCallback(
    async (plaintext: string): Promise<string | null> => {
      // Always re-fetch the owner's public key before encrypting. If the owner
      // rotated keys (e.g. restored from backup on a new device with
      // force_rotate), a stale cached key here would encrypt messages the
      // owner can never read. The GET is cheap and happens once per send.
      if (conversationId) {
        try {
          const fresh = await fetchConversationKeys(slug, conversationId);
          keysRef.current = fresh;
        } catch {
          // Fall back to whatever we have cached.
        }
      }

      if (!keysRef.current?.ownerPublicKey || !keysRef.current?.visitorPublicKey) {
        // Try refreshing once
        await refreshKeys();
        if (!keysRef.current?.ownerPublicKey || !keysRef.current?.visitorPublicKey) {
          return null; // Can't encrypt — send as plaintext
        }
      }

      return encryptMessage(
        plaintext,
        keysRef.current.ownerPublicKey,
        keysRef.current.visitorPublicKey,
      );
    },
    [slug, conversationId, refreshKeys],
  );

  const decrypt = useCallback(
    async (encryptedPayload: string): Promise<string> => {
      const keyId = myKeyIdRef.current;
      if (!keyId) {
        throw new DecryptError("no_key", "No key ID available for this conversation");
      }

      const privateKey = await getPrivateKey(keyId);
      if (!privateKey) {
        throw new DecryptError("no_key", "Private key not found in local storage");
      }

      return decryptMessage(encryptedPayload, privateKey, roleRef.current);
    },
    [],
  );

  return {
    ...state,
    encrypt,
    decrypt,
    refreshKeys,
  };
}
