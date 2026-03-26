"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/relative-time";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
};

type Conversation = {
  id: string;
  label: string;
  message_count: number;
  unread_count: number;
  last_message: {
    content: string;
    is_owner: boolean;
    created_at: string;
  } | null;
};

type Filter = "all" | "unread";

// Deterministic avatar colors from conversation index
const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-rose-500",
  "bg-sky-500",
];

export default function OwnerInbox({ roomId, slug, displayName }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shareableLink, setShareableLink] = useState(`/${slug}`);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const filtered = filter === "unread" ? conversations.filter((c) => c.unread_count > 0) : conversations;

  useEffect(() => {
    setShareableLink(`${window.location.origin}/${slug}`);
    setCanShare(!!navigator.share);
  }, [slug]);

  // Fetch conversations
  useEffect(() => {
    fetch(`/api/rooms/${slug}/conversations`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setConversations(data);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [slug]);

  // Realtime: listen for new messages in ANY conversation for this room
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const msg = payload.new as {
            conversation_id: string;
            content: string;
            is_owner: boolean;
            created_at: string;
          };
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === msg.conversation_id);
            if (idx === -1) {
              // New conversation — refetch the full list to get the label
              fetch(`/api/rooms/${slug}/conversations`)
                .then((r) => r.json())
                .then((data) => {
                  if (Array.isArray(data)) setConversations(data);
                });
              return prev;
            }
            const updated = [...prev];
            const conv = { ...updated[idx] };
            conv.message_count += 1;
            if (!msg.is_owner) {
              conv.unread_count += 1;
            }
            conv.last_message = {
              content: msg.content.slice(0, 80),
              is_owner: msg.is_owner,
              created_at: msg.created_at,
            };
            updated[idx] = conv;
            // Re-sort by latest activity
            updated.sort((a, b) => {
              const aTime = a.last_message?.created_at ?? "";
              const bTime = b.last_message?.created_at ?? "";
              return new Date(bTime).getTime() - new Date(aTime).getTime();
            });
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, slug]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareableLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // read-only input is still selectable as fallback
    }
  }

  async function handleShare() {
    try {
      await navigator.share({
        title: `${displayName} wants your anonymous messages`,
        text: "Send me an anonymous message on Wolow",
        url: shareableLink,
      });
    } catch {
      // user cancelled
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      {/* Header with gradient */}
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Messages</h1>
          <span className="text-xs text-slate-400 bg-surface-light/50 px-2.5 py-1 rounded-full">{displayName}</span>
        </div>

        {/* Share bar */}
        <div className="flex gap-2">
          <input
            readOnly
            value={shareableLink}
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-0 bg-surface/60 backdrop-blur border border-border rounded-xl px-3 py-2
                       text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-accent cursor-text"
          />
          <button
            onClick={handleCopy}
            className="shrink-0 text-xs font-medium bg-surface-light/60 backdrop-blur hover:bg-surface-light text-slate-200
                       px-3.5 py-2 rounded-xl transition-colors border border-border"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          {canShare && (
            <button
              onClick={handleShare}
              className="shrink-0 text-xs font-medium bg-accent text-white
                         px-3.5 py-2 rounded-xl transition-all hover:opacity-90"
            >
              Share
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => setFilter("all")}
            className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all ${
              filter === "all"
                ? "bg-accent text-white shadow-lg shadow-accent-glow"
                : "bg-surface-light/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            Inbox {conversations.length > 0 && conversations.length}
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all ${
              filter === "unread"
                ? "bg-accent text-white shadow-lg shadow-accent-glow"
                : "bg-surface-light/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            Unread {unreadTotal > 0 && unreadTotal}
          </button>
        </div>
      </header>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="px-4 py-4 flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[72px] rounded-2xl animate-pulse bg-surface-light/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-light flex items-center justify-center mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-muted">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <p className="text-slate-300 text-sm font-medium">
              {filter === "unread" ? "All caught up!" : "No conversations yet"}
            </p>
            <p className="text-muted text-xs">
              {filter === "unread" ? "No unread messages" : "Share your link to get started!"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col px-3 py-3 gap-1.5">
            {filtered.map((conv, i) => (
              <a
                key={conv.id}
                href={`/${slug}/inbox/${conv.id}`}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl
                           hover:bg-surface-light/50 transition-all active:scale-[0.98]"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className={`w-11 h-11 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center`}>
                    <span className="text-white text-sm font-bold">
                      {conv.label.replace("Anonymous #", "#")}
                    </span>
                  </div>
                  {conv.unread_count > 0 && (
                    <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-accent rounded-full border-2 border-background" />
                  )}
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${conv.unread_count > 0 ? "font-bold text-white" : "font-medium text-slate-200"}`}>
                      {conv.label}
                    </p>
                    {conv.last_message && (
                      <span className={`text-[11px] shrink-0 ml-2 ${conv.unread_count > 0 ? "text-accent-light font-medium" : "text-muted"}`}>
                        {relativeTime(conv.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${conv.unread_count > 0 ? "text-slate-300" : "text-muted"}`}>
                    {conv.last_message
                      ? `${conv.last_message.is_owner ? "You: " : ""}${conv.last_message.content}`
                      : "No messages yet"}
                  </p>
                </div>
                {/* Unread badge */}
                {conv.unread_count > 0 ? (
                  <span className="shrink-0 min-w-[22px] h-[22px] flex items-center justify-center text-[11px] font-bold text-white bg-accent px-1.5 rounded-full">
                    {conv.unread_count}
                  </span>
                ) : (
                  conv.message_count > 0 && (
                    <span className="shrink-0 text-[11px] text-muted bg-surface-light px-2 py-0.5 rounded-full">
                      {conv.message_count}
                    </span>
                  )
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
