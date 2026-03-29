"use client";

import { useEffect, useRef, useState } from "react";
import GoogleSignIn from "@/components/GoogleSignIn";
import { createClient } from "@/lib/supabase/client";
import { getFunAnonymousEmoji } from "@/lib/fun-anonymous-name";
import { relativeTime } from "@/lib/relative-time";
import { generateKeyPair } from "@/lib/crypto/generate-key-pair";
import { getPrivateKey, storePrivateKey } from "@/lib/crypto/key-storage";
import { uploadOwnerPublicKey } from "@/lib/crypto/upload-public-key";
import { useAuth } from "@/hooks/use-auth";
import { reportError } from "@/lib/report-error";

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
  const [filter, setFilter] = useState<Filter>("all");
  const { user } = useAuth();
  const claimedRef = useRef(false);

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const filtered = filter === "unread" ? conversations.filter((c) => c.unread_count > 0) : conversations;

  useEffect(() => {
    setShareableLink(`${window.location.origin}/${slug}`);
    setCanShare(!!navigator.share);
  }, [slug]);

  useEffect(() => {
    if (!user || claimedRef.current) return;
    claimedRef.current = true;

    void fetch("/api/claim-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, role: "owner" }),
    });
  }, [user, slug]);

  // Pre-generate and upload the owner's public key as soon as they open the inbox.
  // This ensures visiting visitors can always find the owner's key and encrypt immediately.
  useEffect(() => {
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
    <div className="flex flex-col h-full bg-app-gradient">
      {/* Header */}
      <header className="shrink-0 bg-header-gradient px-4 pt-5 pb-4 flex flex-col gap-3">
        <div className="grid grid-cols-3 items-center">
          <a href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/25">
              <svg width="15" height="15" viewBox="0 0 88 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M30.4 77.152C26.304 77.152 23.104 75.8293 20.8 73.184C18.5813 70.4533 17.0453 66.1013 16.192 60.128L13.504 41.696C13.4187 41.0133 13.248 40.544 12.992 40.288C12.736 40.032 12.352 39.904 11.84 39.904H8.384L8 38.496C9.70667 36.96 11.7547 35.7653 14.144 34.912C16.5333 33.9733 18.88 33.504 21.184 33.504C22.464 33.504 23.36 33.888 23.872 34.656C24.4693 35.424 24.9387 36.9173 25.28 39.136L28.608 62.176C29.2053 66.3573 29.888 69.216 30.656 70.752C31.424 72.288 32.576 73.056 34.112 73.056C36.5013 73.056 38.3787 71.6053 39.744 68.704C41.1947 65.7173 41.92 61.792 41.92 56.928C41.92 51.9787 41.28 46.9013 40 41.696C39.8293 41.0133 39.6587 40.544 39.488 40.288C39.3173 40.032 38.9333 39.904 38.336 39.904H35.008L34.624 38.496C36.2453 36.96 38.2507 35.7653 40.64 34.912C43.0293 33.9733 45.4187 33.504 47.808 33.504C49.0027 33.504 49.8987 33.9307 50.496 34.784C51.0933 35.552 51.52 37.0027 51.776 39.136L54.976 61.536C55.6587 66.144 56.384 69.216 57.152 70.752C58.0053 72.288 59.0293 73.056 60.224 73.056C62.528 73.056 64.3627 71.3493 65.728 67.936C67.1787 64.4373 67.904 59.9147 67.904 54.368C67.904 50.6133 67.52 47.3707 66.752 44.64C66.0693 41.824 64.9173 39.3493 63.296 37.216L62.272 35.808L63.168 34.784L73.92 33.504C74.176 36.832 74.304 39.776 74.304 42.336C74.304 53.2587 72.7253 61.792 69.568 67.936C66.496 74.08 62.0587 77.152 56.256 77.152C52.7573 77.152 50.112 76.256 48.32 74.464C46.528 72.672 45.0347 69.3867 43.84 64.608C42.1333 72.9707 37.6533 77.152 30.4 77.152Z" fill="white" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white tracking-wide">Wolow</span>
          </a>
          <h1 className="text-center text-lg font-bold text-white">Messages</h1>
          <span className="justify-self-end text-[11px] uppercase tracking-[0.2em] text-muted">Inbox</span>
        </div>

        <div className="flex items-center justify-end">
          <span className="text-xs text-slate-400 bg-surface-light/50 px-2.5 py-1 rounded-full">{displayName}</span>
        </div>

        <GoogleSignIn returnTo={`/${slug}/inbox`} />

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

      </header>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto pb-24 md:pb-0">
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

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/90 backdrop-blur-lg px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <div className="grid grid-cols-3 gap-2">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-surface-light px-3 py-2 text-slate-200"
            aria-label="Go home"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M9.69 2.22a.75.75 0 0 1 .62 0l6.5 3A.75.75 0 0 1 17.25 5.9v8.2a.75.75 0 0 1-.44.68l-6.5 3a.75.75 0 0 1-.62 0l-6.5-3a.75.75 0 0 1-.44-.68V5.9a.75.75 0 0 1 .44-.68l6.5-3Z" />
            </svg>
          </a>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 transition ${
              filter === "all"
                ? "border-accent/40 bg-accent/20 text-white"
                : "border-border bg-surface-light text-slate-300"
            }`}
            aria-label="Show inbox messages"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M2 5.75A2.75 2.75 0 0 1 4.75 3h10.5A2.75 2.75 0 0 1 18 5.75v8.5A2.75 2.75 0 0 1 15.25 17H4.75A2.75 2.75 0 0 1 2 14.25v-8.5ZM4.75 4.5A1.25 1.25 0 0 0 3.5 5.75v.49l6.11 3.06a.75.75 0 0 0 .78 0L16.5 6.24v-.49a1.25 1.25 0 0 0-1.25-1.25H4.75Zm11.75 3.42-5.44 2.72a2.25 2.25 0 0 1-2.12 0L3.5 7.92v6.33c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V7.92Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setFilter("unread")}
            className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 transition relative ${
              filter === "unread"
                ? "border-accent/40 bg-accent/20 text-white"
                : "border-border bg-surface-light text-slate-300"
            }`}
            aria-label="Show unread messages"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M10 2a5 5 0 0 0-5 5v2.38c0 .53-.21 1.04-.59 1.42L3.7 11.5a.75.75 0 0 0 .53 1.28h11.54a.75.75 0 0 0 .53-1.28l-.71-.7A2.01 2.01 0 0 1 15 9.38V7a5 5 0 0 0-5-5Z" />
              <path d="M8 14a2 2 0 1 0 4 0H8Z" />
            </svg>
            {unreadTotal > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-[10px] font-bold text-white flex items-center justify-center">
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
