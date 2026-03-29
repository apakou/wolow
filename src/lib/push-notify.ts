import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/error-logger";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:push@wolow.app";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type PushParams = {
  roomId: string;
  slug: string;
  conversationId: string;
  senderIsOwner: boolean;
  /** Plaintext preview — omit for E2EE messages to avoid leaking content. */
  contentPreview?: string;
};

/**
 * Send push notifications to the other party in a conversation.
 * Fires-and-forgets: errors are logged but never thrown.
 */
export async function sendPushNotifications({
  roomId,
  slug,
  conversationId,
  senderIsOwner,
  contentPreview,
}: PushParams): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  try {
    const supabase = await createClient();

    // Notify the OTHER role in this conversation/room
    const targetRole = senderIsOwner ? "visitor" : "owner";

    let query = supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth_key")
      .eq("room_id", roomId)
      .eq("role", targetRole);

    // For visitor subscriptions, scope to the conversation
    if (targetRole === "visitor") {
      query = query.eq("conversation_id", conversationId);
    }

    const { data: subscriptions, error } = await query;

    if (error || !subscriptions?.length) return;

    const body = contentPreview
      ? contentPreview.length > 100
        ? contentPreview.slice(0, 97) + "..."
        : contentPreview
      : "New message";

    const url = senderIsOwner
      ? `/${slug}` // visitor sees main chat
      : `/${slug}/inbox/${conversationId}`; // owner sees the conversation thread

    const payload = JSON.stringify({
      title: "Wolow",
      body,
      url,
      conversationId,
    });

    const expiredIds: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key },
            },
            payload,
            { TTL: 60 * 60 } // 1 hour
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            // Subscription expired — mark for deletion
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
