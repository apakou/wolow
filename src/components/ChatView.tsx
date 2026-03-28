"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
  reply_to_message_id?: string | null;
  reactions?: Reaction[];
  /** True while the optimistic insert is in-flight */
  pending?: boolean;
  /** True if the insert failed and the message should show as errored */
  failed?: boolean;
};

type SendMessageResponse = {
  ok?: boolean;
  message?: Message;
  error?: string;
};

export type Reaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export type HeaderSlot = React.ReactNode;

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
  /** Optional conversation scope — when set, only messages for this thread are shown */
  conversationId?: string;
  /** True when the room owner is viewing (owner messages = right/blue).
   *  False when an anonymous sender is viewing (sender messages = right/blue). */
  isOwnerView?: boolean;
  /** Extra content rendered inside the header (e.g. share bar for owner) */
  header?: HeaderSlot;
  inputPlaceholder?: string;
};

const MAX_LENGTH = 1000;
const REACTION_OPTIONS = ["❤️", "👍", "😂", "🔥"];
const LONG_PRESS_MS = 350;
const SWIPE_REPLY_PX = 56;

type ReplyTarget = {
  id: string;
  content: string;
  is_owner: boolean;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function sortReactions(reactions: Reaction[]): Reaction[] {
  return [...reactions].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

function clearMyReactionFromOtherEmojis(reactions: Reaction[], keepEmoji: string): Reaction[] {
  return reactions
    .map((reaction) => {
      if (!reaction.reactedByMe || reaction.emoji === keepEmoji) return reaction;
      const nextCount = reaction.count - 1;
      if (nextCount <= 0) return null;
      return { ...reaction, count: nextCount, reactedByMe: false };
    })
    .filter((reaction): reaction is Reaction => reaction !== null);
}

function addMyReactionToMessage(message: Message, emoji: string): Message {
  const current = clearMyReactionFromOtherEmojis(message.reactions ?? [], emoji);
  const existing = current.find((reaction) => reaction.emoji === emoji);

  if (existing?.reactedByMe) {
    return {
      ...message,
      reactions: sortReactions(current),
    };
  }

  if (existing) {
    return {
      ...message,
      reactions: sortReactions(
        current.map((reaction) =>
          reaction.emoji === emoji
            ? { ...reaction, count: reaction.count + 1, reactedByMe: true }
            : reaction
        )
      ),
    };
  }

  return {
    ...message,
    reactions: sortReactions([...current, { emoji, count: 1, reactedByMe: true }]),
  };
}

function removeMyReactionFromMessage(message: Message, emoji: string): Message {
  const current = message.reactions ?? [];
  const existing = current.find((reaction) => reaction.emoji === emoji);

  if (!existing?.reactedByMe) return message;

  const next = current
    .map((reaction) => {
      if (reaction.emoji !== emoji) return reaction;
      const nextCount = reaction.count - 1;
      if (nextCount <= 0) return null;
      return { ...reaction, count: nextCount, reactedByMe: false };
    })
    .filter((reaction): reaction is Reaction => reaction !== null);

  return {
    ...message,
    reactions: sortReactions(next),
  };
}

function updateMessageReaction(
  messages: Message[],
  messageId: string,
  emoji: string,
  mode: "add" | "remove"
): Message[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    return mode === "add"
      ? addMyReactionToMessage(message, emoji)
      : removeMyReactionFromMessage(message, emoji);
  });
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {[false, true, false, true, false].map((right, i) => (
        <div key={i} className={`flex ${right ? "justify-end" : "justify-start"}`}>
          <div
            className={`h-10 rounded-2xl animate-pulse bg-surface-light/50 ${
              right ? "w-40 rounded-br-md" : "w-52 rounded-bl-md"
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
    <span className="text-[11px] text-muted px-1 select-none">{label}</span>
  );
}

// ─── Bubble ──────────────────────────────────────────────────────────────────

function Bubble({
  message,
  repliedMessage,
  isMine,
  onToggleReaction,
  onSwipeReply,
  isReactionBusy,
}: {
  message: Message;
  repliedMessage?: ReplyTarget | null;
  isMine: boolean;
  onToggleReaction: (messageId: string, emoji: string, hasReacted: boolean) => void;
  onSwipeReply: (message: ReplyTarget) => void;
  isReactionBusy: (messageId: string, emoji: string) => boolean;
}) {
  const reactions = message.reactions ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const swipedForReplyRef = useRef(false);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPressTimer();
  }, [clearPressTimer]);

  useEffect(() => {
    if (!pickerOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!bubbleRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [pickerOpen]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (message.pending) return;
    longPressTriggeredRef.current = false;
    swipedForReplyRef.current = false;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setPickerOpen(true);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (message.pending) return;
    if (startXRef.current === null || startYRef.current === null) return;

    const dx = event.clientX - startXRef.current;
    const dy = event.clientY - startYRef.current;

    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearPressTimer();
    }

    if (swipedForReplyRef.current) return;

    const mostlyHorizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
    const swipeTowardReply = isMine ? dx <= -SWIPE_REPLY_PX : dx >= SWIPE_REPLY_PX;

    if (mostlyHorizontal && swipeTowardReply) {
      swipedForReplyRef.current = true;
      setPickerOpen(false);
      onSwipeReply({ id: message.id, content: message.content, is_owner: message.is_owner });
    }
  };

  const handlePointerEnd = () => {
    clearPressTimer();
    startXRef.current = null;
    startYRef.current = null;
  };

  const handleBubbleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (longPressTriggeredRef.current || swipedForReplyRef.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressTriggeredRef.current = false;
      swipedForReplyRef.current = false;
    }
  };

  return (
    <div
      ref={bubbleRef}
      className={`relative flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}
    >
      <div
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words transition-opacity
          ${isMine
            ? "bg-accent text-white rounded-br-md"
            : "bg-surface-light text-slate-100 rounded-bl-md border border-border"}
          ${message.pending ? "opacity-50" : "opacity-100"}
          ${message.failed ? "!bg-red-900/60 text-red-300" : ""}
        `}
        style={{ touchAction: "pan-y" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onClick={handleBubbleClick}
      >
        {message.reply_to_message_id && repliedMessage && (
          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/15">
            <p className="text-[10px] uppercase tracking-wide text-white/70 mb-0.5">
              Replying to
            </p>
            <p className="text-xs text-white/85 break-words">
              {repliedMessage.content}
            </p>
          </div>
        )}
        {message.content}
        {message.failed && (
          <span className="block text-xs text-red-400 mt-1">Failed to send</span>
        )}
      </div>
      {!message.pending && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {reactions.map((reaction) => (
            <button
              key={`${message.id}-active-${reaction.emoji}`}
              type="button"
              onClick={() => onToggleReaction(message.id, reaction.emoji, reaction.reactedByMe)}
              disabled={isReactionBusy(message.id, reaction.emoji)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition
                ${reaction.reactedByMe
                  ? "bg-accent/20 border-accent text-white"
                  : "bg-surface-light/60 border-border text-slate-200 hover:bg-surface-light"}
                ${isReactionBusy(message.id, reaction.emoji) ? "opacity-50 cursor-wait" : ""}
              `}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      )}
      {!message.pending && (
        <div
          className={`absolute top-full mt-1 z-10 flex items-center gap-1 rounded-full border border-border
            bg-surface/95 backdrop-blur px-1.5 py-1 shadow-lg transition
            ${pickerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
            ${isMine ? "right-0" : "left-0"}
          `}
        >
          {REACTION_OPTIONS.map((emoji) => (
            <button
              key={`${message.id}-pick-${emoji}`}
              type="button"
              onClick={() => {
                const hasReacted = reactions.some(
                  (reaction) => reaction.emoji === emoji && reaction.reactedByMe
                );
                onToggleReaction(message.id, emoji, hasReacted);
                setPickerOpen(false);
              }}
              disabled={isReactionBusy(message.id, emoji)}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm transition
                hover:bg-surface-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                ${isReactionBusy(message.id, emoji) ? "opacity-50 cursor-wait" : ""}
              `}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      {!message.pending && <TimeLabel date={message.created_at} />}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ChatView({
  roomId,
  slug,
  displayName,
  conversationId,
  isOwnerView = false,
  header,
  inputPlaceholder,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newMessageToast, setNewMessageToast] = useState(false);
  const [reactionBusy, setReactionBusy] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [installing, setInstalling] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // track without re-render

  const isReactionBusy = useCallback(
    (messageId: string, emoji: string) => !!reactionBusy[`${messageId}:${emoji}`],
    [reactionBusy]
  );

  const messageById = useMemo(() => {
    const map = new Map<string, ReplyTarget>();
    for (const message of messages) {
      map.set(message.id, {
        id: message.id,
        content: message.content,
        is_owner: message.is_owner,
      });
    }
    return map;
  }, [messages]);

  const hasPendingMessages = useMemo(
    () => messages.some((message) => message.pending),
    [messages]
  );

  const handleSwipeReply = useCallback((message: ReplyTarget) => {
    if (message.content.trim().length === 0) return;
    setReplyTo(message);
  }, []);

  useEffect(() => {
    if (isOwnerView) return;
    if (isStandaloneDisplayMode()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setShowInstallPrompt(true);
    };

    const onAppInstalled = () => {
      setInstallPromptEvent(null);
      setShowInstallPrompt(false);
    };

    const hintTimer = window.setTimeout(() => {
      if (!isStandaloneDisplayMode()) {
        setShowInstallPrompt(true);
      }
    }, 1200);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.clearTimeout(hintTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [isOwnerView]);

  const handleInstallClick = useCallback(async () => {
    if (!installPromptEvent) return;
    try {
      setInstalling(true);
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setShowInstallPrompt(false);
      }
      setInstallPromptEvent(null);
    } finally {
      setInstalling(false);
    }
  }, [installPromptEvent]);

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
    const qs = conversationId ? `?conversation_id=${conversationId}` : "";
    fetch(`/api/rooms/${slug}/messages${qs}`)
      .then((r) => r.json())
      .then((data: Message[]) => {
        setMessages(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [slug, conversationId]);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    const filter = conversationId
      ? `conversation_id=eq.${conversationId}`
      : `room_id=eq.${roomId}`;

    const setReactionFromRealtime = (
      messageId: string,
      emoji: string,
      fromOwner: boolean,
      mode: "insert" | "delete"
    ) => {
      setMessages((prev) => {
        if (!prev.some((message) => message.id === messageId)) return prev;

        const isSameActor = fromOwner === isOwnerView;
        return prev.map((message) => {
          if (message.id !== messageId) return message;

          const reactions = message.reactions ?? [];
          const baseReactions = isSameActor
            ? clearMyReactionFromOtherEmojis(reactions, emoji)
            : reactions;
          const existing = baseReactions.find((reaction) => reaction.emoji === emoji);

          if (mode === "insert") {
            // If this actor already appears reacted in local state, it is likely optimistic.
            if (isSameActor && existing?.reactedByMe) {
              return {
                ...message,
                reactions: sortReactions(baseReactions),
              };
            }

            if (!existing) {
              return {
                ...message,
                reactions: sortReactions([
                  ...baseReactions,
                  { emoji, count: 1, reactedByMe: isSameActor },
                ]),
              };
            }

            return {
              ...message,
              reactions: sortReactions(
                baseReactions.map((reaction) =>
                  reaction.emoji === emoji
                    ? {
                        ...reaction,
                        count: reaction.count + 1,
                        reactedByMe: reaction.reactedByMe || isSameActor,
                      }
                    : reaction
                )
              ),
            };
          }

          if (!existing) return message;
          // If this actor is already marked not reacted, it is likely optimistic removal.
          if (isSameActor && !existing.reactedByMe) return message;

          const next = reactions
            .map((reaction) => {
              if (reaction.emoji !== emoji) return reaction;
              const nextCount = reaction.count - 1;
              if (nextCount <= 0) return null;
              return {
                ...reaction,
                count: nextCount,
                reactedByMe: isSameActor ? false : reaction.reactedByMe,
              };
            })
            .filter((reaction): reaction is Reaction => reaction !== null);

          return { ...message, reactions: sortReactions(next) };
        });
      });
    };

    const channel = supabase
      .channel(`chat:${conversationId ?? roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter,
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
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "reactions",
        },
        (payload) => {
          const incoming = payload.new as {
            message_id?: string;
            emoji?: string;
            is_owner?: boolean;
          };
          if (!incoming.message_id || !incoming.emoji || typeof incoming.is_owner !== "boolean") {
            return;
          }
          setReactionFromRealtime(incoming.message_id, incoming.emoji, incoming.is_owner, "insert");
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "reactions",
        },
        (payload) => {
          const removed = payload.old as {
            message_id?: string;
            emoji?: string;
            is_owner?: boolean;
          };
          if (!removed.message_id || !removed.emoji || typeof removed.is_owner !== "boolean") {
            return;
          }
          setReactionFromRealtime(removed.message_id, removed.emoji, removed.is_owner, "delete");
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId, conversationId]);

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
    if (!content) return;

    const replyTargetId = replyTo?.id ?? null;

    // Optimistic insert
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: optimisticId,
      content,
      is_owner: isOwnerView,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyTargetId,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setReplyTo(null);
    setError(null);
    // Scroll to show the optimistic bubble
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const res = await fetch(`/api/rooms/${slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          conversation_id: conversationId,
          reply_to_message_id: replyTargetId,
        }),
      });

      const data = (await res.json()) as SendMessageResponse;

      if (!res.ok) {
        // Mark optimistic message as failed
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
        );
        setError(data.error ?? "Failed to send");
        return;
      }

      // Replace optimistic message immediately with authoritative server row.
      if (data.message?.id) {
        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
          if (withoutOptimistic.some((m) => m.id === data.message!.id)) {
            return withoutOptimistic;
          }
          return [...withoutOptimistic, data.message!];
        });
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...m, pending: false } : m))
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
      );
      setError("Network error — please try again");
    }
  }

  async function handleToggleReaction(messageId: string, emoji: string, hasReacted: boolean) {
    const busyKey = `${messageId}:${emoji}`;
    if (reactionBusy[busyKey]) return;

    setReactionBusy((prev) => ({ ...prev, [busyKey]: true }));
    setMessages((prev) => updateMessageReaction(prev, messageId, emoji, hasReacted ? "remove" : "add"));

    try {
      const res = await fetch(`/api/rooms/${slug}/reactions`, {
        method: hasReacted ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      });

      if (!res.ok) {
        setMessages((prev) =>
          updateMessageReaction(prev, messageId, emoji, hasReacted ? "add" : "remove")
        );
        setError("Could not update reaction. Please try again.");
      }
    } catch {
      setMessages((prev) =>
        updateMessageReaction(prev, messageId, emoji, hasReacted ? "add" : "remove")
      );
      setError("Network error while updating reaction.");
    } finally {
      setReactionBusy((prev) => {
        const next = { ...prev };
        delete next[busyKey];
        return next;
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-dvh bg-app-gradient">
      {/* Header */}
      <header className="shrink-0 bg-header-gradient border-b border-border">
        {header ?? (
          <div className="px-4 py-3.5">
            <p className="text-[10px] text-muted text-center uppercase tracking-[0.2em]">
              anonymous message for
            </p>
            <h1 className="text-base font-bold text-white text-center truncate">
              {displayName}
            </h1>
            {!isOwnerView && (
              <div className="mt-3 flex flex-col items-center gap-2">
                {showInstallPrompt && (
                  <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-surface-light/70 backdrop-blur-md px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] text-slate-200 leading-snug">
                        Install Wolow for faster access and instant notifications.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowInstallPrompt(false)}
                        className="text-muted hover:text-white transition"
                        aria-label="Dismiss install prompt"
                      >
                        ✕
                      </button>
                    </div>
                    {installPromptEvent ? (
                      <button
                        type="button"
                        onClick={handleInstallClick}
                        disabled={installing}
                        className="mt-2 w-full rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {installing ? "Opening installer..." : "Install app"}
                      </button>
                    ) : (
                      <p className="mt-2 text-[11px] text-muted">
                        Open your browser menu and tap "Add to Home Screen".
                      </p>
                    )}
                  </div>
                )}

                <a
                  href="/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-light px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-surface hover:text-white"
                >
                  <span>Create your own link</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M3.25 10A.75.75 0 0 1 4 9.25h10.19L11.22 6.28a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06l2.97-2.97H4a.75.75 0 0 1-.75-.75Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Scrollable message list */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {!loaded ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-light flex items-center justify-center mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-muted">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
            </div>
            <p className="text-slate-300 text-sm font-medium">No messages yet</p>
            <p className="text-muted text-xs">
              {inputPlaceholder
                ? "Send an anonymous message below"
                : "Share your link to get started!"}
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 flex flex-col gap-3">
            {messages.map((msg) => (
              <Bubble
                key={msg.id}
                message={msg}
                repliedMessage={msg.reply_to_message_id ? messageById.get(msg.reply_to_message_id) : null}
                isMine={isOwnerView ? msg.is_owner : !msg.is_owner}
                onToggleReaction={handleToggleReaction}
                onSwipeReply={handleSwipeReply}
                isReactionBusy={isReactionBusy}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} className="h-px" />

        {/* New-message toast */}
        {newMessageToast && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-accent
                       text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg
                       transition-all animate-bounce"
          >
            New message ↓
          </button>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border bg-surface/80 backdrop-blur-lg px-4 py-3 flex flex-col gap-2"
      >
        {error && <p className="text-xs text-red-400">{error}</p>}
        {replyTo && (
          <div className="flex items-start justify-between gap-2 rounded-xl border border-border bg-surface-light/70 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-accent">Replying to</p>
              <p className="text-xs text-slate-200 truncate">{replyTo.content}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 text-muted hover:text-white transition"
              aria-label="Cancel reply"
            >
              ✕
            </button>
          </div>
        )}
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
            className="flex-1 resize-none bg-surface-light border border-border rounded-2xl px-4 py-3 text-sm
                       text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent
                       focus:border-transparent transition max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={input.trim().length === 0}
            className="shrink-0 bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed
                       text-white p-3 rounded-2xl transition-all shadow-lg"
            aria-label="Send message"
          >
            {hasPendingMessages ? (
              <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-right text-[11px] text-muted">
          {input.length}/{MAX_LENGTH}
        </p>
      </form>
    </div>
  );
}
