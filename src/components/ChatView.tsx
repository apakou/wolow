"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { relativeTime } from "@/lib/relative-time";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Message = {
  id: string;
  content: string;
  is_owner: boolean;
  created_at: string;
  /** True while the optimistic insert is in-flight */
  pending?: boolean;
  /** True if the insert failed and the message should show as errored */
  failed?: boolean;
};

export type HeaderSlot = React.ReactNode;

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
  /** Extra content rendered inside the header (e.g. share bar for owner) */
  header?: HeaderSlot;
  inputPlaceholder?: string;
};

const MAX_LENGTH = 1000;

// ─── Skeleton ────────────────────────────────────────────────────────────────

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {[false, true, false, true, false].map((right, i) => (
        <div key={i} className={`flex ${right ? "justify-end" : "justify-start"}`}>
          <div
            className={`h-9 rounded-2xl animate-pulse bg-zinc-800 ${
              right ? "w-40 rounded-br-sm" : "w-52 rounded-bl-sm"
            }`}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Relative-time label that refreshes every 30 s ───────────────────────────

function TimeLabel({ date }: { date: string }) {
  const [label, setLabel] = useState(() => relativeTime(date));

  useEffect(() => {
    const id = setInterval(() => setLabel(relativeTime(date)), 30_000);
    return () => clearInterval(id);
  }, [date]);

  return (
    <span className="text-[11px] text-zinc-600 px-1 select-none">{label}</span>
  );
}

// ─── Bubble ──────────────────────────────────────────────────────────────────

function Bubble({ message }: { message: Message }) {
  const isOwner = message.is_owner;
  return (
    <div className={`flex flex-col gap-0.5 ${isOwner ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words transition-opacity
          ${isOwner ? "bg-indigo-600 text-white rounded-br-sm" : "bg-zinc-800 text-zinc-100 rounded-bl-sm"}
          ${message.pending ? "opacity-50" : "opacity-100"}
          ${message.failed ? "bg-red-900/60 text-red-300" : ""}
        `}
      >
        {message.content}
        {message.failed && (
          <span className="block text-xs text-red-400 mt-1">Failed to send</span>
        )}
      </div>
      {!message.pending && <TimeLabel date={message.created_at} />}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ChatView({
  roomId,
  slug,
  displayName,
  header,
  inputPlaceholder,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newMessageToast, setNewMessageToast] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // track without re-render

  // ── Detect whether user is scrolled to the bottom ─────────────────────────
  useEffect(() => {
    const sentinel = bottomRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        atBottomRef.current = entry.isIntersecting;
        if (entry.isIntersecting) setNewMessageToast(false);
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loaded]);

  // ── Fetch existing messages ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/rooms/${slug}/messages`)
      .then((r) => r.json())
      .then((data: Message[]) => {
        setMessages(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [slug]);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) => {
            // Replace matching optimistic message or deduplicate
            const optimisticIdx = prev.findIndex(
              (m) => m.pending && m.content === incoming.content && m.is_owner === incoming.is_owner
            );
            if (optimisticIdx !== -1) {
              const next = [...prev];
              next[optimisticIdx] = incoming;
              return next;
            }
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          // Show toast only if scrolled up
          if (!atBottomRef.current) setNewMessageToast(true);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  // ── Auto-scroll when at bottom ────────────────────────────────────────────
  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ── Scroll to bottom (used by initial load + toast click) ─────────────────
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setNewMessageToast(false);
  }, []);

  // ── Initial scroll after load ─────────────────────────────────────────────
  useEffect(() => {
    if (loaded) scrollToBottom();
  }, [loaded, scrollToBottom]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

    // Optimistic insert
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      content,
      is_owner: false, // will be corrected by DB; owner flag comes from cookie
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    setError(null);
    // Scroll to show the optimistic bubble
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const res = await fetch(`/api/rooms/${slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = await res.json();
        // Mark optimistic message as failed
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
        );
        setError(data.error ?? "Failed to send");
        return;
      }
      // Realtime will replace the optimistic message; if it doesn't arrive
      // within ~3 s (e.g. realtime not enabled), remove the pending bubble.
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId || !m.pending));
      }, 3000);
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
      );
      setError("Network error — please try again");
    } finally {
      setSending(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    // dvh = dynamic viewport height — shrinks when mobile keyboard opens
    <div className="flex flex-col h-dvh bg-zinc-950">
      {/* Header */}
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950">
        {header ?? (
          <div className="px-4 py-3">
            <p className="text-xs text-zinc-500 text-center uppercase tracking-widest">
              anonymous message for
            </p>
            <h1 className="text-base font-semibold text-white text-center truncate">
              {displayName}
            </h1>
          </div>
        )}
      </header>

      {/* Scrollable message list */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {!loaded ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center">
            <p className="text-zinc-400 text-sm font-medium">No messages yet</p>
            <p className="text-zinc-600 text-xs">
              {inputPlaceholder
                ? "Send an anonymous message below"
                : "Share your link to get started!"}
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 flex flex-col gap-3">
            {messages.map((msg) => (
              <Bubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
        <div ref={bottomRef} className="h-px" />

        {/* New-message toast */}
        {newMessageToast && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-indigo-600 hover:bg-indigo-500
                       text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg
                       transition-colors animate-bounce"
          >
            New message ↓
          </button>
        )}
      </div>

      {/* Input — stays above virtual keyboard because dvh shrinks the container */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3 flex flex-col gap-2"
      >
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder={inputPlaceholder ?? `Send ${displayName} an anonymous message…`}
            maxLength={MAX_LENGTH}
            rows={1}
            className="flex-1 resize-none bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm
                       text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500
                       focus:border-transparent transition max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={sending || input.trim().length === 0}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
        <p className="text-right text-xs text-zinc-700">
          {input.length}/{MAX_LENGTH}
        </p>
      </form>
    </div>
  );
}
