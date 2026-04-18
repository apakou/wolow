import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getFunAnonymousName, getFunAnonymousEmoji } from "@/lib/fun-anonymous-name";
import { relativeTime } from "@/lib/relative-time";

export const metadata = { title: "Sent — Wolow" };

export default async function SentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Fetch this user's sent conversations with the room they were sent to
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, created_at, rooms(slug, display_name)")
    .eq("sender_user_id", user.id)
    .order("created_at", { ascending: false });

  // For each conversation, get the latest message
  const convIds = (conversations ?? []).map((c) => c.id);
  const { data: latestMessages } = convIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id, content, is_owner, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Build a map of conversation_id → latest message
  const latestMap = new Map<
    string,
    { content: string; is_owner: boolean; created_at: string }
  >();
  for (const msg of latestMessages ?? []) {
    if (!latestMap.has(msg.conversation_id)) {
      latestMap.set(msg.conversation_id, msg);
    }
  }

  type RoomRef = { slug: string; display_name: string } | null;
  const items = (conversations ?? []).map((conv) => ({
    id: conv.id,
    label: getFunAnonymousName(conv.id),
    emoji: getFunAnonymousEmoji(conv.id),
    room: (conv.rooms as unknown as RoomRef),
    last_message: latestMap.get(conv.id) ?? null,
    created_at: conv.created_at as string,
  }));

  // Get the signed-in user's own room slug for the back link
  const { data: myRoom } = await supabase
    .from("rooms")
    .select("slug")
    .eq("user_id", user.id)
    .single();

  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      {/* Header */}
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-4 flex items-center gap-3">
        {myRoom && (
          <Link
            href={`/${myRoom.slug}/inbox`}
            className="p-1.5 rounded-xl hover:bg-surface-light transition-colors"
            aria-label="Back to inbox"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5 text-slate-300"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
        )}
        <h1 className="text-lg font-bold text-white">Sent</h1>
      </header>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-light flex items-center justify-center mb-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6 text-muted"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                />
              </svg>
            </div>
            <p className="text-slate-300 text-sm font-medium">No sent messages yet</p>
            <p className="text-muted text-xs">
              Visit someone&apos;s link to start an anonymous conversation
            </p>
          </div>
        ) : (
          <div className="flex flex-col px-3 py-3 gap-1.5">
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.room ? `/${item.room.slug}` : "#"}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-surface-light/50 transition-all active:scale-[0.98]"
              >
                {/* Avatar */}
                <div className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg">
                  <span className="text-white text-xl leading-none" role="img" aria-label={item.label}>
                    {item.emoji}
                  </span>
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {item.room?.display_name ?? "Unknown"}
                    </p>
                    {item.last_message && (
                      <span className="text-[11px] shrink-0 ml-2 text-muted">
                        {relativeTime(item.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs truncate mt-0.5 text-muted">
                    {item.last_message
                      ? `${item.last_message.is_owner ? "Them: " : "You: "}${item.last_message.content}`
                      : "No messages yet"}
                  </p>
                </div>
                {/* Chevron */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-4 h-4 text-muted shrink-0"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
