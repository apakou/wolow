/**
 * FCM (Firebase Cloud Messaging) sender for mobile push notifications.
 *
 * Env-gated: set FIREBASE_SERVICE_ACCOUNT_JSON to the service account JSON
 * (raw or base64-encoded). When unset, FCM sends are skipped the web push
 * path is unaffected, so this degrades to previous behavior (tasks/lessons.md:
 * feature gated on config must degrade, not dead-end).
 */
import { logError } from "@/lib/error-logger";

type FcmSendResult = "sent" | "expired" | "failed" | "unconfigured";

type MessagingModule = typeof import("firebase-admin/messaging");

let initPromise: Promise<MessagingModule["getMessaging"] | null> | null = null;

function parseServiceAccount(raw: string): Record<string, unknown> | null {
  const attempts = [
    () => JSON.parse(raw),
    () => JSON.parse(Buffer.from(raw, "base64").toString("utf8")),
  ];
  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (parsed && typeof parsed === "object" && "project_id" in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next format
    }
  }
  return null;
}

/**
 * Lazily initialize firebase-admin once per process.
 * Returns null when unconfigured or on init failure (logged loudly).
 */
async function getMessagingFactory() {
  if (!initPromise) {
    initPromise = (async () => {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "";
      if (!raw) return null;

      const serviceAccount = parseServiceAccount(raw);
      if (!serviceAccount) {
        console.error(
          "[push-fcm] FIREBASE_SERVICE_ACCOUNT_JSON is set but not valid JSON/base64 JSON FCM disabled"
        );
        return null;
      }

      try {
        const { initializeApp, getApps, cert } = await import("firebase-admin/app");
        const { getMessaging } = await import("firebase-admin/messaging");
        if (getApps().length === 0) {
          initializeApp({
            credential: cert(serviceAccount as Parameters<typeof cert>[0]),
          });
        }
        return getMessaging;
      } catch (err) {
        console.error(
          `[push-fcm] firebase-admin init failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return null;
      }
    })();
  }
  return initPromise;
}

/** True when FCM credentials are configured (cheap check, no init). */
export function isFcmConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

/**
 * Send one FCM notification to a device token.
 *
 * @returns "expired" when the token is dead and should be deleted.
 */
export async function sendFcmNotification(params: {
  token: string;
  title: string;
  body: string;
  url: string;
  conversationId: string;
}): Promise<FcmSendResult> {
  const getMessaging = await getMessagingFactory();
  if (!getMessaging) return "unconfigured";

  try {
    await getMessaging().send({
      token: params.token,
      notification: {
        title: params.title,
        body: params.body,
      },
      // The Flutter app routes taps from `data` (works for background taps too).
      data: {
        url: params.url,
        conversationId: params.conversationId,
      },
      android: {
        // Collapse multiple notifications per conversation (parity with the
        // web service worker's per-conversation `tag`).
        collapseKey: params.conversationId,
        ttl: 60 * 60 * 1000, // 1h, matches web push TTL
        notification: { tag: params.conversationId },
      },
      apns: {
        headers: {
          "apns-collapse-id": params.conversationId,
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 60 * 60),
        },
        payload: {
          aps: { "thread-id": params.conversationId },
        },
      },
    });
    return "sent";
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      return "expired";
    }
    logError({
      message: `FCM send failed (${code || "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
      endpoint: "/push-fcm",
      method: "INTERNAL",
    });
    return "failed";
  }
}
