"use client";

import { useCallback, useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Convert a URL-safe base64 VAPID key to an ArrayBuffer for PushManager. */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

type PushState = {
  /** Browser supports Web Push */
  supported: boolean;
  /** Current Notification permission */
  permission: NotificationPermission | "unsupported";
  /** Whether this browser is currently subscribed for this room */
  isSubscribed: boolean;
  /** Loading state during subscribe/unsubscribe */
  loading: boolean;
  /** Subscribe to push notifications */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<void>;
};

/**
 * Hook for managing Web Push notification subscriptions.
 *
 * @param slug           - Room slug for the API endpoint
 * @param role           - "owner" | "visitor"
 * @param conversationId - Required when role is "visitor"
 */
export function usePushNotifications(
  slug: string,
  role: "owner" | "visitor",
  conversationId?: string
): PushState {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check support & existing subscription on mount
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      !VAPID_PUBLIC_KEY
    ) {
      return;
    }

    setSupported(true);
    setPermission(Notification.permission);

    // Check if already subscribed
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setIsSubscribed(sub !== null))
      .catch(() => {});
  }, []);

  // If the user has already granted notification permission but we're not
  // subscribed (e.g. DB row was wiped, new device, or PWA reinstall), silently
  // re-subscribe in the background. This avoids re-prompting the user via the
  // "Enable notifications" modal when they already said yes.
  useEffect(() => {
    if (!supported || isSubscribed || loading) return;
    if (permission !== "granted") return;
    void subscribe();
    // subscribe is stable enough — guarded by `loading` flag inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, isSubscribed, permission]);

  const subscribe = useCallback(async () => {
    if (!supported || loading) return;
    setLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const keys = sub.toJSON().keys ?? {};

      await fetch(`/api/rooms/${encodeURIComponent(slug)}/push-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: keys.p256dh,
          auth_key: keys.auth,
          ...(role === "visitor" && conversationId ? { conversation_id: conversationId } : {}),
        }),
      });

      setIsSubscribed(true);
    } catch {
      // Permission denied or network failure — UI stays in unsubscribed state
    } finally {
      setLoading(false);
    }
  }, [supported, loading, slug, role, conversationId]);

  const unsubscribe = useCallback(async () => {
    if (!supported || loading) return;
    setLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        // Notify backend first, then unsubscribe from push manager
        await fetch(`/api/rooms/${encodeURIComponent(slug)}/push-subscription`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }

      setIsSubscribed(false);
    } catch {
      // Swallow — worst case the subscription stays
    } finally {
      setLoading(false);
    }
  }, [supported, loading, slug]);

  return { supported, permission, isSubscribed, loading, subscribe, unsubscribe };
}
