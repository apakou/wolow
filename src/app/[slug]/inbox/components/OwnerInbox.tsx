"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getFunAnonymousEmoji } from "@/lib/fun-anonymous-name";
import { relativeTime } from "@/lib/relative-time";
import { generateKeyPair } from "@/lib/crypto/generate-key-pair";
import { getPrivateKey, storePrivateKey } from "@/lib/crypto/key-storage";
import { uploadOwnerPublicKey } from "@/lib/crypto/upload-public-key";
import { reportError } from "@/lib/report-error";
import { usePushNotifications } from "@/lib/push/use-push-notifications";

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

export default function OwnerInbox({ roomId, slug, displayName }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shareableLink, setShareableLink] = useState(`/${slug}`);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showPushPopup, setShowPushPopup] = useState(false);

  const push = usePushNotifications(slug, "owner");

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const filtered = filter === "unread" ? conversations.filter((c) => c.unread_count > 0) : conversations;

  useEffect(() => {
    setShareableLink(`${window.location.origin}/${slug}`);
    setCanShare(!!navigator.share);
  }, [slug]);

  // Show push popup if not already subscribed/dismissed
  useEffect(() => {
    const dismissedVal = localStorage.getItem(`push_popup_dismissed_${slug}`);
    const dismissedTs = parseInt(dismissedVal ?? "", 10);
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    const isDismissed =
      !!dismissedVal && (isNaN(dismissedTs) || Date.now() - dismissedTs < THREE_DAYS);
    if (
      push.supported &&
      !push.isSubscribed &&
      push.permission !== "denied" &&
      !isDismissed
    ) {
      const timer = setTimeout(() => setShowPushPopup(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [push.supported, push.isSubscribed, push.permission, slug]);

  // Pre-generate and upload the owner's public key as soon as they open the inbox.
  // This ensures visiting visitors can always find the owner's key and encrypt immediately.
  useEffect(() => {
    if (typeof crypto === "undefined" || !crypto.subtle) return;
    const keyId = `room:${slug}`;
    (async () => {
      try {
        const existing = await getPrivateKey(keyId);
        if (!existing) {
          const { publicKey, privateKey } = await generateKeyPair();
          // Upload FIRST — only store locally if upload succeeds
          await uploadOwnerPublicKey(slug, publicKey);
          await storePrivateKey(keyId, privateKey);
        } else {
          // Key exists locally — verify it was uploaded to server, re-upload if not
          const res = await fetch(`/api/rooms/${slug}/keys`);
          if (res.ok) {
            const data = await res.json();
            if (!data.owner_public_key) {
              // Extract the public part from the stored private JWK
              const publicJwk: JsonWebKey = {
                kty: existing.kty, n: existing.n, e: existing.e,
                alg: existing.alg, ext: true, key_ops: ["encrypt"],
              };
              await uploadOwnerPublicKey(slug, publicJwk);
            }
          }
        }
      } catch (err) {
        console.error("[E2EE-Inbox] Key init error:", err);
      }
    })();
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
      .catch((err: unknown) => {
        reportError({ message: err instanceof Error ? err.message : "Failed to fetch conversations", endpoint: `/api/rooms/${slug}/conversations`, slug });
        setLoaded(true);
      });
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
      // Fallback for HTTP contexts or denied clipboard permission
      try {
        const el = document.createElement("input");
        el.value = shareableLink;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // last resort: just select the text in the input
      }
    }
  }

  async function handleShare() {
    if (canShare) {
      try {
        await navigator.share({
          title: `${displayName} wants your anonymous messages`,
          text: "Send me an anonymous message on Wolow",
          url: shareableLink,
        });
        return;
      } catch {
        // user cancelled or not supported — fall through to menu
      }
    }
    // Desktop: toggle the share menu
    setShowShareMenu((prev) => !prev);
  }

  // Close share menu on outside click
  useEffect(() => {
    if (!showShareMenu) return;
    function handler(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showShareMenu]);

  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      {/* Header */}
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
          <div className="relative" ref={shareMenuRef}>
            <button
              onClick={handleShare}
              className="shrink-0 text-xs font-medium bg-accent text-white
                         px-3.5 py-2 rounded-xl transition-all hover:opacity-90 flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.518 2.518 0 0 1 0 .792l6.733 3.367a2.5 2.5 0 1 1-.671 1.341l-6.733-3.367a2.5 2.5 0 1 1 0-3.474l6.733-3.366A2.52 2.52 0 0 1 13 4.5Z" />
              </svg>
              Share
            </button>
            {showShareMenu && (
              <div className="absolute right-0 top-full mt-2 z-50 w-48 rounded-2xl border border-border bg-surface/95 backdrop-blur shadow-2xl overflow-hidden">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${displayName} wants your anonymous messages — ${shareableLink}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-surface-light transition-colors"
                >
                  <span className="text-base">💬</span> WhatsApp
                </a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(shareableLink)}&text=${encodeURIComponent(`${displayName} wants your anonymous messages`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-surface-light transition-colors"
                >
                  <span className="text-base">✈️</span> Telegram
                </a>
                <a
                  href={`https://x.com/intent/post?text=${encodeURIComponent(`${displayName} wants your anonymous messages — ${shareableLink}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowShareMenu(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-surface-light transition-colors"
                >
                  <span className="text-base">𝕏</span> X (Twitter)
                </a>
                <button
                  type="button"
                  onClick={() => { handleCopy(); setShowShareMenu(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-surface-light transition-colors border-t border-border"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted">
                    <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                    <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
                  </svg>
                  Copy link
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => setFilter("all")}
            className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all ${
              filter === "all"
                ? "bg-accent text-white"
                : "bg-surface-light/50 text-slate-400 hover:text-slate-200"
            }`}
          >
            Inbox {conversations.length > 0 && conversations.length}
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all ${
              filter === "unread"
                ? "bg-accent text-white"
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
            {filtered.map((conv) => (
              <a
                key={conv.id}
                href={`/${slug}/inbox/${conv.id}`}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl
                           hover:bg-surface-light/50 transition-all active:scale-[0.98]"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-lg">
                    <span className="text-white text-xl leading-none" role="img" aria-label={conv.label}>
                      {getFunAnonymousEmoji(conv.id)}
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
                      <span className={`text-[11px] shrink-0 ml-2 ${conv.unread_count > 0 ? "text-accent font-medium" : "text-muted"}`}>
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
      {/* Push notification popup */}
      {showPushPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#1a1a2e] shadow-2xl p-6 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-full bg-accent/15 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-accent">
                <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0 1 13.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 0 1-.573 1.23H3.705a.75.75 0 0 1-.573-1.23A8.973 8.973 0 0 0 5.25 9.75V9ZM8.159 18.846c.069.216.16.424.271.62a3.598 3.598 0 0 0 7.14 0 3.18 3.18 0 0 0 .27-.62H8.16Z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-white text-center">Stay in the loop</h2>
            <p className="text-sm text-slate-300 text-center leading-relaxed">
              Turn on notifications so you never miss an anonymous message.
            </p>
            <button
              type="button"
              onClick={async () => {
                await push.subscribe();
                setShowPushPopup(false);
              }}
              disabled={push.loading}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {push.loading ? "Enabling..." : "Enable notifications"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPushPopup(false);
                localStorage.setItem(`push_popup_dismissed_${slug}`, String(Date.now()));
              }}
              className="text-xs text-muted hover:text-slate-300 transition"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
