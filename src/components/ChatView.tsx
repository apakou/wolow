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
import { useE2EE } from "@/lib/crypto/use-e2ee";
import { usePushNotifications } from "@/lib/push/use-push-notifications";
import { isInstallPromptOpen } from "@/lib/pwa";
import { reportError } from "@/lib/report-error";
import { isDecryptError, type DecryptErrorReason } from "@/lib/crypto/decrypt-errors";
import DecryptErrorBubble from "@/components/DecryptErrorBubble";
import Link from "next/link";
import Confetti, { makeConfettiParticles, type ConfettiParticle } from "@/components/Confetti";
import PromptCard from "@/components/PromptCard";
import { STARTER_TEMPLATES, nextRandomIndex } from "@/lib/prompts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Message = {
  id: string;
  content: string;
  is_owner: boolean;
  created_at: string;
  reply_to_message_id?: string | null;
  encrypted_content?: string | null;
  reactions?: Reaction[];
  /** True while the optimistic insert is in-flight */
  pending?: boolean;
  /** True if the insert failed and the message should show as errored */
  failed?: boolean;
  /** Decrypted plaintext (set client-side after decryption) */
  decryptedContent?: string;
  /** Set when decryption failed drives DecryptErrorBubble rendering */
  decryptError?: { reason: DecryptErrorReason; message: string };
  /** True when the message was received via broadcast (before DB confirms) */
  _fromBroadcast?: boolean;
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
  /** Optional conversation scope when set, only messages for this thread are shown */
  conversationId?: string;
  /** True when the room owner is viewing (owner messages = right/blue).
   *  False when an anonymous sender is viewing (sender messages = right/blue). */
  isOwnerView?: boolean;
  /** Extra content rendered inside the header (e.g. share bar for owner) */
  header?: HeaderSlot;
  /** Extra content rendered just above the composer (e.g. anonymity explainer) */
  aboveComposer?: React.ReactNode;
  inputPlaceholder?: string;
  /** Visual treatment "dark" (plain) or "candy" (playful). Both dark-based. */
  variant?: ChatVariant;
  /** Templates the 🎲 dice inserts into the composer (candy variant) */
  starterTemplates?: readonly string[];
  /** Disables the composer entirely (e.g. blocked conversation) */
  composerDisabled?: boolean;
};

const MAX_LENGTH = 1000;
const REACTION_OPTIONS = ["❤️", "👍", "😂", "🔥"];
const LONG_PRESS_MS = 350;
const SWIPE_REPLY_PX = 56;

// ─── Visual variants ─────────────────────────────────────────────────────────
// "dark" is the owner-side default its class strings are the pre-variant
// originals, verbatim. "candy" is the playful NGL-style visitor treatment:
// vivid gradient, white cards, chunky display type, squishy buttons.

export type ChatVariant = "dark" | "candy";

const STYLES: Record<
  ChatVariant,
  {
    root: string;
    header: string;
    headerTitle: string;
    bubbleMine: string;
    bubbleTheirs: string;
    reactionPillActive: string;
    reactionPillIdle: string;
    picker: string;
    pickerBtn: string;
    timeLabel: string;
    newMsgToast: string;
    skeletonBubble: string;
    composer: string;
    errorText: string;
    replyBar: string;
    replyLabel: string;
    replyText: string;
    replyCancel: string;
    input: string;
    sendBtn: string;
    counter: string;
    statusMuted: string;
    statusLink: string;
  }
> = {
  dark: {
    root: "flex h-dvh flex-col overflow-hidden overscroll-none bg-app-gradient",
    header: "shrink-0 bg-header-gradient border-b border-border",
    headerTitle: "text-base font-bold text-white truncate",
    bubbleMine: "bg-accent text-white rounded-br-md",
    bubbleTheirs: "bg-surface-light text-slate-100 rounded-bl-md border border-border",
    reactionPillActive: "bg-accent/20 border-accent text-white",
    reactionPillIdle: "bg-surface-light/60 border-border text-slate-200 hover:bg-surface-light",
    picker: "border-border bg-surface/95",
    pickerBtn: "hover:bg-surface-light focus-visible:ring-secondary",
    timeLabel: "text-[11px] text-muted px-1 select-none",
    newMsgToast: "bg-accent text-white",
    skeletonBubble: "bg-surface-light/50",
    composer:
      "shrink-0 border-t border-border bg-surface/80 backdrop-blur-lg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2",
    errorText: "text-xs text-red-400",
    replyBar:
      "flex items-start justify-between gap-2 rounded-xl border border-border bg-surface-light/70 px-3 py-2",
    replyLabel: "text-[11px] uppercase tracking-wide text-secondary",
    replyText: "text-xs text-slate-200 truncate",
    replyCancel: "shrink-0 text-muted hover:text-white transition",
    input:
      "flex-1 resize-none bg-surface-light border border-border rounded-2xl px-4 py-3 text-base text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition max-h-32 overflow-y-auto disabled:opacity-50",
    sendBtn:
      "shrink-0 bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white p-3 rounded-2xl transition-all shadow-lg",
    counter: "text-[11px] text-muted",
    statusMuted: "text-[11px] text-muted",
    statusLink: "text-[11px] text-secondary underline",
  },
  candy: {
    root: "flex h-dvh flex-col overflow-hidden overscroll-none bg-app-gradient",
    header: "shrink-0 bg-header-gradient border-b border-border",
    headerTitle: "font-display text-base font-bold text-white truncate",
    bubbleMine: "bg-accent text-white rounded-br-md",
    bubbleTheirs: "bg-surface-light text-slate-100 rounded-bl-md border border-border",
    reactionPillActive: "bg-accent/20 border-accent text-white",
    reactionPillIdle: "bg-surface-light/60 border-border text-slate-200 hover:bg-surface-light",
    picker: "border-border bg-surface/95",
    pickerBtn: "hover:bg-surface-light focus-visible:ring-secondary",
    timeLabel: "text-[11px] text-muted px-1 select-none",
    newMsgToast: "bg-accent text-white",
    skeletonBubble: "bg-surface-light/50",
    composer:
      "shrink-0 border-t border-border bg-surface/80 backdrop-blur-lg px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2",
    errorText: "text-xs text-red-400",
    replyBar:
      "flex items-start justify-between gap-2 rounded-xl border border-border bg-surface-light/70 px-3 py-2",
    replyLabel: "text-[11px] uppercase tracking-wide text-secondary",
    replyText: "text-xs text-slate-200 truncate",
    replyCancel: "shrink-0 text-muted hover:text-white transition",
    input:
      "flex-1 resize-none bg-surface-light border border-border rounded-3xl px-4 py-3 text-base text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition max-h-32 overflow-y-auto disabled:opacity-50",
    sendBtn:
      "btn-squish shrink-0 bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white p-3 rounded-full transition-all shadow-lg",
    counter: "text-[11px] text-muted",
    statusMuted: "text-[11px] text-muted",
    statusLink: "text-[11px] text-secondary underline",
  },
};

type ReplyTarget = {
  id: string;
  content: string;
  is_owner: boolean;
};

// ─── Notification Bell ───────────────────────────────────────────────────────

function NotificationBell({
  slug,
  role,
  conversationId,
}: {
  slug: string;
  role: "owner" | "visitor";
  conversationId?: string;
}) {
  const { supported, permission, isSubscribed, loading, subscribe, unsubscribe } =
    usePushNotifications(slug, role, conversationId);

  if (!supported) return null;

  const denied = permission === "denied";
  const active = isSubscribed && !denied;

  return (
    <button
      type="button"
      onClick={active ? unsubscribe : subscribe}
      disabled={loading || denied}
      className="shrink-0 p-1 rounded-lg text-muted hover:text-white transition disabled:opacity-40"
      aria-label={active ? "Disable notifications" : "Enable notifications"}
      title={denied ? "Notifications blocked update browser settings" : active ? "Notifications on" : "Turn on notifications"}
    >
      {active ? (
        /* Bell filled */
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-secondary">
          <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0 1 13.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 0 1-.573 1.23H3.705a.75.75 0 0 1-.573-1.23A8.973 8.973 0 0 0 5.25 9.75V9ZM8.159 18.846c.069.216.16.424.271.62a3.598 3.598 0 0 0 7.14 0 3.18 3.18 0 0 0 .27-.62H8.16Z" clipRule="evenodd" />
        </svg>
      ) : (
        /* Bell outline */
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
      )}
    </button>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function MessageSkeleton({ V }: { V: (typeof STYLES)[ChatVariant] }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {[false, true, false, true, false].map((right, i) => (
        <div key={i} className={`flex ${right ? "justify-end" : "justify-start"}`}>
          <div
            className={`h-10 rounded-2xl animate-pulse ${V.skeletonBubble} ${
              right ? "w-40 rounded-br-md" : "w-52 rounded-bl-md"
            }`}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Relative-time label that refreshes every 30 s ───────────────────────────

function TimeLabel({ date, className }: { date: string; className: string }) {
  const [label, setLabel] = useState(() => relativeTime(date));

  useEffect(() => {
    const id = setInterval(() => setLabel(relativeTime(date)), 30_000);
    return () => clearInterval(id);
  }, [date]);

  return <span className={className}>{label}</span>;
}

// ─── Bubble ──────────────────────────────────────────────────────────────────

function Bubble({
  message,
  repliedMessage,
  isMine,
  isOwnerView,
  variant,
  onToggleReaction,
  onSwipeReply,
  isReactionBusy,
}: {
  message: Message;
  repliedMessage?: ReplyTarget | null;
  isMine: boolean;
  isOwnerView: boolean;
  variant: ChatVariant;
  onToggleReaction: (messageId: string, emoji: string, hasReacted: boolean) => void;
  onSwipeReply: (message: ReplyTarget) => void;
  isReactionBusy: (messageId: string, emoji: string) => boolean;
}) {
  const V = STYLES[variant];
  // In-bubble reply preview both variants use dark bubbles for "mine" and
  // dark surfaces for "theirs", so white-on-dark preview text works everywhere.
  const replyPreview = {
    box: "mb-2 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/15",
    label: "text-[10px] uppercase tracking-wide text-white/70 mb-0.5",
    text: "text-xs text-white/85 break-words",
  };
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
      if (message.decryptError) return;
      onSwipeReply({ id: message.id, content: message.decryptedContent ?? message.content, is_owner: message.is_owner });
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
      {message.decryptError ? (
        <div
          style={{ touchAction: "pan-y" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerLeave={handlePointerEnd}
          onClick={handleBubbleClick}
        >
          <DecryptErrorBubble
            reason={message.decryptError.reason}
            isOwnerView={isOwnerView}
            isMine={isMine}
          />
        </div>
      ) : (
        <div
          className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words transition-opacity
            ${isMine ? V.bubbleMine : V.bubbleTheirs}
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
            <div className={replyPreview.box}>
              <p className={replyPreview.label}>
                Replying to
              </p>
              <p className={replyPreview.text}>
                {repliedMessage.content}
              </p>
            </div>
          )}
          {message.decryptedContent ?? message.content}
          {message.encrypted_content && !message.failed && (
            <span className="inline-block ml-1 text-[10px] opacity-50" title="End-to-end encrypted">🔒</span>
          )}
          {message.failed && (
            <span className="block text-xs text-red-400 mt-1">Failed to send</span>
          )}
        </div>
      )}
      {!message.pending && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {reactions.map((reaction) => (
            <button
              key={`${message.id}-active-${reaction.emoji}`}
              type="button"
              onClick={() => onToggleReaction(message.id, reaction.emoji, reaction.reactedByMe)}
              disabled={isReactionBusy(message.id, reaction.emoji)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition
                ${reaction.reactedByMe ? V.reactionPillActive : V.reactionPillIdle}
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
          className={`absolute top-full mt-1 z-10 flex items-center gap-1 rounded-full border ${V.picker}
            backdrop-blur px-1.5 py-1 shadow-lg transition
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
                focus-visible:outline-none focus-visible:ring-2 ${V.pickerBtn}
                ${isReactionBusy(message.id, emoji) ? "opacity-50 cursor-wait" : ""}
              `}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          {!message.decryptError && (
            <>
              <span className="mx-0.5 h-4 w-px bg-white/15" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  onSwipeReply({
                    id: message.id,
                    content: message.decryptedContent ?? message.content,
                    is_owner: message.is_owner,
                  });
                }}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm transition
                  focus-visible:outline-none focus-visible:ring-2 ${V.pickerBtn}`}
                aria-label="Reply to this message"
                title="Reply"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-slate-200">
                  <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}
      {!message.pending && <TimeLabel date={message.created_at} className={V.timeLabel} />}
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
  aboveComposer,
  inputPlaceholder,
  variant = "dark",
  starterTemplates = STARTER_TEMPLATES,
  composerDisabled = false,
}: Props) {
  const V = STYLES[variant];
  const isCandy = variant === "candy";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [newMessageToast, setNewMessageToast] = useState(false);
  const [pushToast, setPushToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [reactionBusy, setReactionBusy] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [showPushPopup, setShowPushPopup] = useState(false);
  // Candy-only celebration state (first successful send in a conversation)
  const [confettiParticles, setConfettiParticles] = useState<ConfettiParticle[] | null>(null);
  const [showSentCard, setShowSentCard] = useState(false);
  // Dice: retrigger the wiggle animation per press via key remount
  const [diceKey, setDiceKey] = useState(0);
  const lastTemplateRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // track without re-render
  const loadedRef = useRef(false);
  const coarsePointerRef = useRef(false);
  // Holds the active Supabase realtime channel so handleSubmit can broadcast instantly
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  const push = usePushNotifications(slug, isOwnerView ? "owner" : "visitor", conversationId);
  const e2ee = useE2EE({ slug, conversationId, isOwnerView });

  // Show push popup once messages load, if not yet subscribed and not recently dismissed
  useEffect(() => {
    const dismissedVal = localStorage.getItem(`push_popup_dismissed_${slug}`);
    const dismissedTs = parseInt(dismissedVal ?? "", 10);
    // Treat old "1" value (ts=1, year 1970) or a timestamp within the last 3 days as dismissed
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    const isDismissed =
      !!dismissedVal && (isNaN(dismissedTs) || Date.now() - dismissedTs < THREE_DAYS);
    if (
      loaded &&
      push.supported &&
      !push.isSubscribed &&
      push.permission === "default" &&
      !isDismissed
    ) {
      const timer = setTimeout(() => {
        // Don't stack on top of the one-time install invite popup
        if (!isInstallPromptOpen()) setShowPushPopup(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [loaded, push.supported, push.isSubscribed, push.permission, slug]);

  // Clear any "encryption not ready" error once E2EE becomes ready
  useEffect(() => {
    if (e2ee.ready) setError(null);
  }, [e2ee.ready]);

  // Re-decrypt messages that failed because the private key wasn't loaded yet.
  // This handles the race where messages are fetched before the key is available
  // in IndexedDB (e.g. first-time key generation, slow IndexedDB read).
  useEffect(() => {
    if (!e2ee.keyLoaded || !loaded) return;
    let cancelled = false;

    (async () => {
      // Grab current messages via functional update pattern to avoid stale closure
      let messagesToRetry: Message[] = [];
      setMessages((prev) => {
        messagesToRetry = prev.filter(
          (m) => m.encrypted_content && m.decryptError?.reason === "no_key"
        );
        return prev; // Don't change state yet
      });

      if (messagesToRetry.length === 0) return;

      const retried = await Promise.all(
        messagesToRetry.map(async (msg) => {
          try {
            const plain = await e2ee.decrypt(msg.encrypted_content!);
            return { id: msg.id, decryptedContent: plain };
          } catch {
            return null; // Still can't decrypt leave as-is
          }
        })
      );

      if (cancelled) return;

      const updates = new Map(
        retried
          .filter((r): r is { id: string; decryptedContent: string } => r !== null)
          .map((r) => [r.id, r.decryptedContent])
      );

      if (updates.size === 0) return;

      setMessages((prev) =>
        prev.map((m) => {
          const plain = updates.get(m.id);
          return plain !== undefined
            ? { ...m, decryptedContent: plain, decryptError: undefined }
            : m;
        })
      );
    })();

    return () => { cancelled = true; };
  }, [e2ee.keyLoaded, loaded, e2ee.decrypt]);

  // Decrypt a single message in-place (returns same ref if unencrypted)
  const decryptMessageContent = useCallback(
    async (msg: Message): Promise<Message> => {
      if (!msg.encrypted_content || msg.decryptedContent) return msg;
      try {
        const plain = await e2ee.decrypt(msg.encrypted_content);
        return { ...msg, decryptedContent: plain, decryptError: undefined };
      } catch (err) {
        if (isDecryptError(err)) {
          return { ...msg, decryptError: { reason: err.reason, message: err.message } };
        }
        return {
          ...msg,
          decryptError: {
            reason: "unknown",
            message: err instanceof Error ? err.message : "Unknown decryption error",
          },
        };
      }
    },
    [e2ee.decrypt],
  );

  // Bulk-decrypt an array of messages
  const decryptAll = useCallback(
    async (msgs: Message[]): Promise<Message[]> => {
      return Promise.all(msgs.map(decryptMessageContent));
    },
    [decryptMessageContent],
  );

  const isReactionBusy = useCallback(
    (messageId: string, emoji: string) => !!reactionBusy[`${messageId}:${emoji}`],
    [reactionBusy]
  );

  const messageById = useMemo(() => {
    const map = new Map<string, ReplyTarget>();
    for (const message of messages) {
      const previewContent = message.decryptError
        ? "[encrypted message]"
        : message.decryptedContent ?? message.content;
      map.set(message.id, {
        id: message.id,
        content: previewContent,
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

  // ── Dice: insert a starter template (candy variant only) ──────────────────
  // Never destroys user-typed text: it only writes when the composer is empty
  // or still holds the previously inserted template; otherwise it renders
  // disabled so the affordance is honest.
  const diceDisabled = input.trim().length > 0 && input !== lastTemplateRef.current;

  const handleDice = useCallback(() => {
    const currentIdx = lastTemplateRef.current
      ? starterTemplates.indexOf(lastTemplateRef.current)
      : -1;
    const nextIdx = nextRandomIndex(currentIdx, starterTemplates.length);
    const template = starterTemplates[nextIdx];
    lastTemplateRef.current = template;
    setInput(template);
    setDiceKey((k) => k + 1);
    textareaRef.current?.focus();
  }, [starterTemplates]);

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

  // ── Fetch existing messages (also used for retry and reconnect catch-up) ──
  const fetchMessages = useCallback(async () => {
    const qs = conversationId ? `?conversation_id=${conversationId}` : "";
    try {
      const res = await fetch(`/api/rooms/${slug}/messages${qs}`);
      const data: unknown = await res.json();
      if (!res.ok || !Array.isArray(data)) {
        throw new Error("Failed to fetch messages");
      }
      const decrypted = await decryptAll(data as Message[]);
      setMessages((prev) => {
        // Preserve local in-flight/failed bubbles the server doesn't know yet
        const localExtras = prev.filter(
          (m) => (m.pending || m.failed) && !decrypted.some((d) => d.id === m.id)
        );
        return [...decrypted, ...localExtras];
      });
      setLoadError(false);
      setLoaded(true);
    } catch (err: unknown) {
      reportError({ message: err instanceof Error ? err.message : "Failed to fetch messages", endpoint: `/api/rooms/${slug}/messages`, slug });
      // Never masquerade a network failure as an empty conversation
      setLoadError(true);
      setLoaded(true);
    }
  }, [slug, conversationId, decryptAll]);

  const fetchMessagesRef = useRef(fetchMessages);
  useEffect(() => {
    fetchMessagesRef.current = fetchMessages;
  }, [fetchMessages]);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  // Refetch when the tab becomes visible again mobile browsers freeze
  // WebSockets in the background, so messages can be missed silently.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && loadedRef.current) {
        void fetchMessagesRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // On touch devices Enter inserts a newline (no Shift key exists); sending is
  // done via the send button. On fine-pointer devices Enter sends.
  useEffect(() => {
    coarsePointerRef.current =
      window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  }, []);

  // Auto-grow the composer with its content (capped by the max-h-32 class)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  // Auto-hide the push-notification feedback toast
  useEffect(() => {
    if (!pushToast) return;
    const timer = setTimeout(() => setPushToast(null), 3000);
    return () => clearTimeout(timer);
  }, [pushToast]);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let hadDrop = false;
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
        "broadcast",
        { event: "new_message" },
        (event) => {
          const incoming = event.payload as Message & { optimistic_id?: string };
          // Skip our own broadcasts (we already have the optimistic message)
          if (incoming.is_owner === isOwnerView) return;
          decryptMessageContent(incoming).then((decrypted) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === decrypted.id || (incoming.optimistic_id && m.id === incoming.optimistic_id))) return prev;
              return [...prev, { ...decrypted, _fromBroadcast: true }];
            });
            if (!atBottomRef.current) setNewMessageToast(true);
          });
        }
      )
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
          // Decrypt if needed, then update state
          decryptMessageContent(incoming).then((decrypted) => {
            setMessages((prev) => {
              // Deduplicate by ID first (POST response likely already replaced optimistic)
              if (prev.some((m) => m.id === decrypted.id)) return prev;
              // Replace matching optimistic OR broadcast-placeholder message.
              // Match by encrypted_content (exact) when available it's deterministic
              // across broadcast and postgres_changes and unaffected by decrypt failures.
              // Fall back to plaintext content match for non-encrypted messages.
              const placeholderIdx = prev.findIndex((m) => {
                if (!(m.pending || m._fromBroadcast)) return false;
                if (m.is_owner !== decrypted.is_owner) return false;
                if (decrypted.encrypted_content && m.encrypted_content) {
                  return m.encrypted_content === decrypted.encrypted_content;
                }
                return (m.decryptedContent ?? m.content) === (decrypted.decryptedContent ?? decrypted.content);
              });
              if (placeholderIdx !== -1) {
                const next = [...prev];
                const placeholder = prev[placeholderIdx];
                // Prefer the placeholder's already-decrypted plaintext if this
                // handler's decrypt failed prevents a successfully-displayed
                // message from flipping to an error bubble.
                const placeholderDecrypted = placeholder.decryptedContent;
                const thisDecryptFailed =
                  !!decrypted.encrypted_content && !!decrypted.decryptError;
                const bestDecrypted =
                  thisDecryptFailed && placeholderDecrypted
                    ? placeholderDecrypted
                    : decrypted.decryptedContent;
                const bestError =
                  thisDecryptFailed && placeholderDecrypted
                    ? undefined
                    : decrypted.decryptError;
                next[placeholderIdx] = {
                  ...decrypted,
                  decryptedContent: bestDecrypted,
                  decryptError: bestError,
                };
                return next;
              }
              return [...prev, decrypted];
            });
            // Show toast only if scrolled up
            if (!atBottomRef.current) setNewMessageToast(true);
          });
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
      .subscribe((status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          if (hadDrop) {
            hadDrop = false;
            // Catch up on anything missed while the socket was down
            void fetchMessagesRef.current();
          }
          setReconnecting(false);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          // supabase-js retries automatically; tell the user in the meantime
          hadDrop = true;
          setReconnecting(true);
        }
      });

    channelRef.current = channel;
    return () => {
      disposed = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
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
    if (composerDisabled) return;
    const content = input.trim();
    if (!content) return;

    // Guard: crypto is available but E2EE not ready yet
    const cryptoAvailable = typeof crypto !== "undefined" && !!crypto.subtle;
    // Legacy conversation: my local key works, but the other party never
    // uploaded a public key (pre-E2EE conversation). Fall through to plaintext
    // instead of blocking the owner from ever replying.
    const otherPartyHasKey = isOwnerView ? e2ee.visitorKeyOnServer : e2ee.ownerKeyOnServer;
    const isLegacyConversation = cryptoAvailable && e2ee.keyLoaded && !otherPartyHasKey;

    if (cryptoAvailable && !e2ee.ready && !isLegacyConversation) {
      if (
        e2ee.error === "owner_key_missing_restore_required" ||
        e2ee.error === "owner_key_conflict_restore_required"
      ) {
        setError(
          "Your encryption key isn't on this device. Restore it from your .wolow-key backup in Settings to read and send messages.",
        );
      } else {
        setError("Encryption is still setting up. Please wait a moment and try again.");
      }
      return;
    }

    const replyTargetId = replyTo?.id ?? null;

    // Optimistic insert show the plaintext immediately
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: optimisticId,
      content,
      decryptedContent: content,
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
      // E2EE: encrypt if available, send plaintext if crypto is unavailable (non-HTTPS dev)
      let bodyPayload: Record<string, unknown>;

      if (cryptoAvailable && e2ee.ready) {
        const encryptedContent = await e2ee.encrypt(content);
        if (!encryptedContent) {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
          );
          setError("Encryption failed. Please try again.");
          return;
        }
        bodyPayload = {
          content: "\u{1F512}",
          conversation_id: conversationId,
          reply_to_message_id: replyTargetId,
          encrypted_content: encryptedContent,
        };
      } else {
        // No crypto (insecure context) send unencrypted
        bodyPayload = {
          content,
          conversation_id: conversationId,
          reply_to_message_id: replyTargetId,
        };
      }

      // Broadcast over the open WebSocket channel for instant delivery to the other party.
      // The postgres_changes event will arrive later and just deduplicate.
      channelRef.current?.send({
        type: "broadcast",
        event: "new_message",
        payload: {
          id: optimisticId,
          optimistic_id: optimisticId,
          content: bodyPayload.encrypted_content ? "\u{1F512}" : content,
          decryptedContent: content,
          encrypted_content: bodyPayload.encrypted_content ?? null,
          is_owner: isOwnerView,
          created_at: optimistic.created_at,
          reply_to_message_id: replyTargetId,
        },
      });

      const res = await fetch(`/api/rooms/${slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
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
        const serverMsg = { ...data.message, decryptedContent: content };
        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
          if (withoutOptimistic.some((m) => m.id === serverMsg.id)) {
            return withoutOptimistic;
          }
          return [...withoutOptimistic, serverMsg];
        });
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...m, pending: false } : m))
        );
      }

      // First-send celebration (sender side only): confetti + one-shot card
      // nudging them to share their own auto-provisioned link.
      // localStorage guard keeps it to exactly once per conversation.
      if (isCandy && !isOwnerView && conversationId) {
        const celebratedKey = `wolow:celebrated:${conversationId}`;
        if (!localStorage.getItem(celebratedKey)) {
          localStorage.setItem(celebratedKey, "1");
          setConfettiParticles(makeConfettiParticles());
          setShowSentCard(true);
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, pending: false, failed: true } : m))
      );
      reportError({ message: err instanceof Error ? err.message : "Send message network error", endpoint: `/api/rooms/${slug}/messages`, method: "POST", slug });
      setError("Network error please try again");
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
    } catch (err) {
      setMessages((prev) =>
        updateMessageReaction(prev, messageId, emoji, hasReacted ? "add" : "remove")
      );
      reportError({ message: err instanceof Error ? err.message : "Reaction network error", endpoint: `/api/rooms/${slug}/reactions`, slug });
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
    <div className={V.root}>
      {/* Header compact single row: back · avatar · name + trust line · bell */}
      <header className={V.header}>
        {header ?? (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            {!isOwnerView && (
              <Link
                href="/"
                className="shrink-0 w-9 h-9 rounded-full bg-surface-light/60 flex items-center justify-center text-slate-400 hover:text-white hover:bg-surface-light transition-all"
                aria-label="Back to my inbox"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            )}
            {isCandy && (
              <div
                className="anim-pop-in shrink-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-accent font-display text-base font-bold text-white select-none"
                aria-hidden="true"
              >
                {displayName.trim().charAt(0).toUpperCase() || "💬"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className={V.headerTitle}>
                {displayName}
              </h1>
              {!isOwnerView && (
                <p className="flex items-center gap-1 text-[11px] text-muted truncate">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-3 h-3 shrink-0 text-emerald-400"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate">
                    {isCandy ? "you're anonymous · encrypted" : "You're anonymous · Encrypted"}
                  </span>
                </p>
              )}
            </div>
            <NotificationBell slug={slug} role={isOwnerView ? "owner" : "visitor"} conversationId={conversationId} />
          </div>
        )}
      </header>

      {/* Scrollable message list */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {reconnecting && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none sticky top-2 z-10 flex justify-center"
          >
            <span className="rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-[11px] font-medium text-amber-300 backdrop-blur">
              Reconnecting…
            </span>
          </div>
        )}
        {!loaded ? (
          <MessageSkeleton V={V} />
        ) : loadError && messages.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-light flex items-center justify-center mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-amber-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM21.75 12a9.75 9.75 0 1 1-19.5 0 9.75 9.75 0 0 1 19.5 0Z" />
              </svg>
            </div>
            <p className="text-slate-300 text-sm font-medium">Couldn&apos;t load messages</p>
            <p className="text-muted text-xs">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => {
                setLoaded(false);
                setLoadError(false);
                void fetchMessages();
              }}
              className="mt-2 rounded-full bg-accent px-5 py-2 text-xs font-semibold text-white transition hover:opacity-90"
            >
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          isCandy && !isOwnerView ? (
            <PromptCard displayName={displayName} />
          ) : (
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
          )
        ) : (
          <div className="px-4 py-4 flex flex-col gap-3">
            {messages.map((msg) => (
              <Bubble
                key={msg.id}
                message={msg}
                repliedMessage={msg.reply_to_message_id ? messageById.get(msg.reply_to_message_id) : null}
                isMine={isOwnerView ? msg.is_owner : !msg.is_owner}
                isOwnerView={isOwnerView}
                variant={variant}
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
            className={`absolute bottom-3 left-1/2 -translate-x-1/2 ${V.newMsgToast}
                       text-xs font-medium px-4 py-2 rounded-full shadow-lg
                       transition-all animate-bounce`}
          >
            New message ↓
          </button>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className={V.composer}
      >
        {aboveComposer}
        {error && <p className={V.errorText}>{error}</p>}
        {replyTo && (
          <div className={V.replyBar}>
            <div className="min-w-0">
              <p className={V.replyLabel}>Replying to</p>
              <p className={V.replyText}>{replyTo.content}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className={V.replyCancel}
              aria-label="Cancel reply"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          {isCandy && (
            <button
              type="button"
              onClick={handleDice}
              disabled={diceDisabled || composerDisabled}
              className="btn-squish shrink-0 flex h-[46px] w-[46px] items-center justify-center rounded-full border border-border bg-surface-light transition hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Give me an idea"
              title={diceDisabled ? "Clear the box to roll an idea" : "Roll a message idea"}
            >
              <span key={diceKey} className="anim-wiggle inline-block text-xl leading-none" aria-hidden="true">
                🎲
              </span>
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends only on fine-pointer devices; on touch keyboards
              // Enter inserts a newline (there is no Shift+Enter on mobile).
              if (e.key === "Enter" && !e.shiftKey && !coarsePointerRef.current) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder={inputPlaceholder ?? `Send ${displayName} an anonymous message…`}
            maxLength={MAX_LENGTH}
            rows={1}
            disabled={composerDisabled}
            aria-label={inputPlaceholder ?? `Send ${displayName} an anonymous message`}
            className={V.input}
          />
          <button
            type="submit"
            disabled={input.trim().length === 0 || composerDisabled}
            title={undefined}
            className={V.sendBtn}
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
        <div className="flex justify-between items-center">
          {!e2ee.ready ? (
            e2ee.error === "owner_key_missing_restore_required" ||
            e2ee.error === "owner_key_conflict_restore_required" ? (
              <Link href="/settings" className={V.statusLink}>
                Restore your key to send messages
              </Link>
            ) : e2ee.error && e2ee.error.includes("HTTPS") ? (
              <p className={V.statusMuted}>Unencrypted conversation</p>
            ) : e2ee.error ? (
              <p className={V.errorText}>Encryption couldn&apos;t start. Refresh to try again.</p>
            ) : e2ee.keyLoaded && !(isOwnerView ? e2ee.visitorKeyOnServer : e2ee.ownerKeyOnServer) ? (
              <p className={V.statusMuted}>Unencrypted conversation</p>
            ) : (
              <p className={`${V.statusMuted} animate-pulse`}>Setting up encryption…</p>
            )
          ) : (
            <span />
          )}
          <p className={V.counter}>
            {input.length}/{MAX_LENGTH}
          </p>
        </div>
      </form>

      {/* Push subscription feedback toast */}
      {pushToast && (
        <div
          role="status"
          className={`anim-pop-in fixed top-4 left-1/2 -translate-x-1/2 z-[70] whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold text-white shadow-lg ${
            pushToast.type === "ok" ? "bg-accent" : "bg-red-600"
          }`}
        >
          {pushToast.text}
        </div>
      )}

      {/* First-send celebration (candy): confetti + growth loop card */}
      {confettiParticles !== null && (
        <Confetti particles={confettiParticles} onDone={() => setConfettiParticles(null)} />
      )}
      {showSentCard && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
          <div className="anim-pop-in w-full max-w-sm rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <p className="font-display text-xl font-bold text-ink">sent 🎉</p>
              <button
                type="button"
                onClick={() => setShowSentCard(false)}
                className="text-ink/40 hover:text-ink transition"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-ink/70 leading-relaxed">
              they won&apos;t know it was you. you&apos;ve got an inbox too share
              your link and get honest messages back.
            </p>
            <Link
              href="/"
              className="btn-squish mt-4 block w-full rounded-full bg-ink px-4 py-3 text-center font-display text-sm font-bold text-white shadow-lg"
            >
              share my link ✨
            </Link>
          </div>
        </div>
      )}

      {/* Push notification popup */}
      {showPushPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-surface shadow-2xl p-6 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
            {/* Bell icon */}
            <div className="w-14 h-14 rounded-full bg-accent/15 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-secondary">
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
                const result = await push.subscribe();
                setShowPushPopup(false);
                if (result === "subscribed") {
                  setPushToast({ type: "ok", text: "Notifications on 🔔" });
                } else if (result === "failed") {
                  setPushToast({
                    type: "err",
                    text: "Couldn't turn on notifications. Try again from the bell icon.",
                  });
                }
                // "denied": the user answered the OS prompt no extra nagging
              }}
              disabled={push.loading}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {push.loading ? "Enabling…" : "Enable notifications"}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPushPopup(false);
                // Snooze for 3 days store current timestamp so the popup can re-appear later
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
