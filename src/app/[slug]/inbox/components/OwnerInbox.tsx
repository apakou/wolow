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

export default function OwnerInbox({ roomId, slug, displayName }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shareableLink, setShareableLink] = useState(`/${slug}`);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

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
    <div className="flex flex-col h-dvh bg-zinc-950">
      {/* Header */}
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-4 pt-3 pb-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-white">Your inbox</h1>
          <span className="text-xs text-zinc-500">{displayName}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-zinc-500">Share this link to receive messages</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={shareableLink}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5
                         text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-700 cursor-text"
            />
            <button
              onClick={handleCopy}
              className="shrink-0 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200
                         px-3 py-1.5 rounded-lg transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            {canShare && (
              <button
                onClick={handleShare}
                className="shrink-0 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white
                           px-3 py-1.5 rounded-lg transition-colors"
              >
                Share
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="px-4 py-4 flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse bg-zinc-800" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 px-8 text-center">
            <p className="text-zinc-400 text-sm font-medium">No conversations yet</p>
            <p className="text-zinc-600 text-xs">Share your link to get started!</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {conversations.map((conv) => (
              <a
                key={conv.id}
                href={`/${slug}/inbox/${conv.id}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60
                           hover:bg-zinc-900/50 transition-colors"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center">
                    <span className="text-indigo-400 text-sm font-semibold">
                      {conv.label.replace("Anonymous #", "#")}
                    </span>
                  </div>
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${conv.unread_count > 0 ? "font-bold text-white" : "font-medium text-white"}`}>
                      {conv.label}
                    </p>
                    {conv.last_message && (
                      <span className={`text-[11px] shrink-0 ml-2 ${conv.unread_count > 0 ? "text-indigo-400" : "text-zinc-600"}`}>
                        {relativeTime(conv.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${conv.unread_count > 0 ? "text-zinc-300" : "text-zinc-500"}`}>
                    {conv.last_message
                      ? `${conv.last_message.is_owner ? "You: " : ""}${conv.last_message.content}`
                      : "No messages yet"}
                  </p>
                </div>
                {/* Unread badge */}
                {conv.unread_count > 0 ? (
                  <span className="shrink-0 min-w-[20px] h-5 flex items-center justify-center text-[11px] font-bold text-white bg-indigo-600 px-1.5 rounded-full">
                    {conv.unread_count}
                  </span>
                ) : (
                  conv.message_count > 0 && (
                    <span className="shrink-0 text-[11px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
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
