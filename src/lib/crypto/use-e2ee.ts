"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateKeyPair } from "@/lib/crypto/generate-key-pair";
import { storePrivateKey, getPrivateKey } from "@/lib/crypto/key-storage";
import { uploadOwnerPublicKey, uploadVisitorPublicKey } from "@/lib/crypto/upload-public-key";
import { fetchConversationKeys, type ConversationKeys } from "@/lib/crypto/fetch-public-key";
import { encryptMessage } from "@/lib/crypto/encrypt-message";
import { decryptMessage } from "@/lib/crypto/decrypt-message";

interface UseE2EEOptions {
  slug: string;
  conversationId: string | undefined;
  isOwnerView: boolean;
}

interface E2EEState {
  ready: boolean;
  encrypting: boolean;
  error: string | null;
}

export function useE2EE({ slug, conversationId, isOwnerView }: UseE2EEOptions) {
  const [state, setState] = useState<E2EEState>({
    ready: false,
    encrypting: false,
    error: null,
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
      setState({ ready: false, encrypting: false, error: "E2EE unavailable (requires HTTPS)" });
      return;
    }
    if (lastConvRef.current === conversationId) return;
    lastConvRef.current = conversationId;
    roleRef.current = isOwnerView ? "owner" : "visitor";

    const keyId = isOwnerView ? `room:${slug}` : `conv:${conversationId}`;
    myKeyIdRef.current = keyId;

    (async () => {
      try {
        // 1. Check if we already have a private key locally
        let existingPrivateKey = await getPrivateKey(keyId);

        // 2. If not, generate a new keypair and upload the public key
        if (!existingPrivateKey) {
          const { publicKey, privateKey } = await generateKeyPair();

          // Upload public key to server FIRST — only store locally on success
          if (isOwnerView) {
            await uploadOwnerPublicKey(slug, publicKey);
          } else {
            await uploadVisitorPublicKey(slug, conversationId, publicKey);
          }

          await storePrivateKey(keyId, privateKey);
          existingPrivateKey = privateKey;
        }

        // 3. Fetch both parties' public keys
        const keys = await fetchConversationKeys(slug, conversationId);
        keysRef.current = keys;

        // 4. Recovery: if our key exists locally but not on server, re-upload it
        const myKeyMissing = isOwnerView ? !keys.ownerPublicKey : !keys.visitorPublicKey;
        if (myKeyMissing && existingPrivateKey) {
          const publicJwk: JsonWebKey = {
            kty: existingPrivateKey.kty, n: existingPrivateKey.n, e: existingPrivateKey.e,
            alg: existingPrivateKey.alg, ext: true, key_ops: ["encrypt"],
          };
          if (isOwnerView) {
            await uploadOwnerPublicKey(slug, publicJwk);
          } else {
            await uploadVisitorPublicKey(slug, conversationId, publicJwk);
          }
          const refreshed = await fetchConversationKeys(slug, conversationId);
          keysRef.current = refreshed;
          keys.ownerPublicKey = refreshed.ownerPublicKey;
          keys.visitorPublicKey = refreshed.visitorPublicKey;
        }

        // Ready if both parties have keys
        const bothReady = !!keys.ownerPublicKey && !!keys.visitorPublicKey;
        setState({ ready: bothReady, encrypting: false, error: null });
      } catch (err) {
        console.error("[E2EE] Init error:", err);
        // Allow retry on next mount/conversationId change
        lastConvRef.current = null;
        setState({ ready: false, encrypting: false, error: (err as Error).message });
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
          setState((prev) => ({ ...prev, ready: true }));
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
      setState((prev) => ({ ...prev, ready: bothReady }));
    } catch {
      // Silent — we'll retry on next message
    }
  }, [slug, conversationId]);

  const encrypt = useCallback(
    async (plaintext: string): Promise<string | null> => {
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
    [refreshKeys],
  );

  const decrypt = useCallback(
    async (encryptedPayload: string): Promise<string> => {
      const keyId = myKeyIdRef.current;
      if (!keyId) throw new Error("No key ID available");

      const privateKey = await getPrivateKey(keyId);
      if (!privateKey) throw new Error("Private key not found in local storage");

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
