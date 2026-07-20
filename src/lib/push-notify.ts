import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";
import { isFcmConfigured, sendFcmNotification } from "@/lib/push-fcm";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:push@wolow.app";

const webPushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (webPushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type PushParams = {
  roomId: string;
  slug: string;
  conversationId: string;
  senderIsOwner: boolean;
  /** Plaintext preview omit for E2EE messages to avoid leaking content. */
  contentPreview?: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string | null;
  auth_key: string | null;
  kind: "webpush" | "fcm";
};

/**
 * Fetch subscriptions for the target role, resilient to migration 031
 * (the `kind` column) not having been applied yet in that case all rows
 * are Web Push by definition (degrade loudly, tasks/lessons.md).
 */
async function fetchSubscriptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string,
  conversationId: string,
  targetRole: "owner" | "visitor"
): Promise<SubscriptionRow[]> {
  const buildQuery = (columns: string) => {
    let query = supabase
      .from("push_subscriptions")
      .select(columns)
      .eq("room_id", roomId)
      .eq("role", targetRole);
    if (targetRole === "visitor") {
      query = query.eq("conversation_id", conversationId);
    }
    return query;
  };

  const { data, error } = await buildQuery("id, endpoint, p256dh, auth_key, kind");
  if (!error) {
    return (data ?? []) as unknown as SubscriptionRow[];
  }

  console.error(
    `[push-notify] Select with kind failed (${error.code ?? "?"}): ${error.message} ` +
      "is migration 031_push_subscription_kinds.sql applied? Falling back to webpush-only."
  );

  const { data: fallback, error: fallbackError } = await buildQuery(
    "id, endpoint, p256dh, auth_key"
  );
  if (fallbackError) return [];
  return ((fallback ?? []) as unknown as Omit<SubscriptionRow, "kind">[]).map(
    (row) => ({ ...row, kind: "webpush" as const })
  );
}

/**
 * Send push notifications to the other party in a conversation.
 * Handles both Web Push (browsers/PWA) and FCM (mobile app) subscriptions.
 * Fires-and-forgets: errors are logged but never thrown.
 */
export async function sendPushNotifications({
  roomId,
  slug,
  conversationId,
  senderIsOwner,
  contentPreview,
}: PushParams): Promise<void> {
  if (!webPushConfigured && !isFcmConfigured()) return;

  try {
    const supabase = await createClient();

    // Notify the OTHER role in this conversation/room
    const targetRole = senderIsOwner ? "visitor" : "owner";

    const subscriptions = await fetchSubscriptions(
      supabase,
      roomId,
      conversationId,
      targetRole
    );
    if (!subscriptions.length) return;

    const body = contentPreview
      ? contentPreview.length > 100
        ? contentPreview.slice(0, 97) + "..."
        : contentPreview
      : "New message";

    const url = senderIsOwner
      ? `/${slug}` // visitor sees main chat
      : `/${slug}/inbox/${conversationId}`; // owner sees the conversation thread

    const webPushPayload = JSON.stringify({
      title: "Wolow",
      body,
      url,
      conversationId,
    });

    const expiredIds: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        if (sub.kind === "fcm") {
          const result = await sendFcmNotification({
            token: sub.endpoint,
            title: "Wolow",
            body,
            url,
            conversationId,
          });
          if (result === "expired") expiredIds.push(sub.id);
          return;
        }

        if (!webPushConfigured || !sub.p256dh || !sub.auth_key) return;
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key },
            },
            webPushPayload,
            { TTL: 60 * 60 } // 1 hour
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            // Subscription expired mark for deletion
            expiredIds.push(sub.id);
          }
        }
      })
    );

    // Clean up expired subscriptions
    if (expiredIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", expiredIds);
    }
  } catch (err) {
    logError({
      message: `Push notification failed: ${err instanceof Error ? err.message : String(err)}`,
      endpoint: "/push-notify",
      method: "INTERNAL",
      slug,
    });
  }
}
