"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ChatView from "@/components/ChatView";
import { getFunAnonymousEmoji } from "@/lib/fun-anonymous-name";
import { REPLY_TEMPLATES } from "@/lib/prompts";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
  conversationId: string;
  conversationLabel: string;
  initiallyBlocked?: boolean;
};

export default function OwnerThread({
  roomId,
  slug,
  displayName,
  conversationId,
  conversationLabel,
  initiallyBlocked = false,
}: Props) {
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Mark conversation as read when the owner opens it
  useEffect(() => {
    fetch(`/api/rooms/${slug}/conversations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {
      // Non-fatal the unread badge clears on the next successful open.
    });
  }, [slug, conversationId]);

  // Close the options menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmingBlock(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  async function updateBlocked(nextBlocked: boolean) {
    setBlockBusy(true);
    setBlockError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}/conversations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, blocked: nextBlocked }),
      });
      if (!res.ok) throw new Error("Request failed");
      setBlocked(nextBlocked);
      setMenuOpen(false);
      setConfirmingBlock(false);
    } catch {
      setBlockError(
        nextBlocked
          ? "Couldn't block this sender. Please try again."
          : "Couldn't unblock. Please try again."
      );
    } finally {
      setBlockBusy(false);
    }
  }

  const reportHref = `mailto:report@wolow.app?subject=${encodeURIComponent(
    `Report conversation ${conversationId}`
  )}&body=${encodeURIComponent(
    `Room: /${slug}\nConversation: ${conversationId}\nAnonymous sender: ${conversationLabel}\n\nWhat happened?\n`
  )}`;

  // Compact single row mirrors the sender header anatomy exactly:
  // back · avatar · name + trust line · options, so both sides feel like one app.
  const header = (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <Link
        href={`/${slug}/inbox`}
        className="shrink-0 w-9 h-9 rounded-full bg-surface-light/60 flex items-center justify-center text-slate-400 hover:text-white hover:bg-surface-light transition-all"
        aria-label="Back to inbox"
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
      <div
        className="anim-pop-in shrink-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-accent text-base select-none"
        aria-hidden="true"
      >
        {getFunAnonymousEmoji(conversationId)}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="font-display text-base font-bold text-white truncate">
          {conversationLabel}
        </h1>
        {/* Persistent E2EE reassurance line */}
        <p className="flex items-center gap-1 text-[11px] text-muted min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0 text-emerald-400" aria-hidden="true">
            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
          </svg>
          <span className="truncate">end-to-end encrypted · only you can read this</span>
          <a href="/help" target="_blank" className="shrink-0 text-secondary hover:underline">
            How?
          </a>
        </p>
      </div>
      {/* Conversation options: block / report */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => {
            setMenuOpen((open) => !open);
            setConfirmingBlock(false);
            setBlockError(null);
          }}
          className="w-9 h-9 rounded-full bg-surface-light/60 flex items-center justify-center text-slate-400 hover:text-white hover:bg-surface-light transition-all"
          aria-label="Conversation options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M3 10a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM8.5 10a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM15.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl border border-border bg-surface/95 backdrop-blur shadow-2xl overflow-hidden">
            {confirmingBlock ? (
              <div className="p-4 flex flex-col gap-3">
                <p className="text-sm font-medium text-slate-100">Block this sender?</p>
                <p className="text-xs text-muted leading-relaxed">
                  They won&apos;t be able to send you new messages. You can unblock them
                  anytime.
                </p>
                {blockError && (
                  <p className="text-xs text-red-400" role="alert">
                    {blockError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => updateBlocked(true)}
                    disabled={blockBusy}
                    className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                  >
                    {blockBusy ? "Blocking…" : "Block"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingBlock(false)}
                    disabled={blockBusy}
                    className="flex-1 rounded-xl bg-surface-light px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-surface disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {blocked ? (
                  <button
                    type="button"
                    onClick={() => updateBlocked(false)}
                    disabled={blockBusy}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-surface-light transition-colors disabled:opacity-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                    </svg>
                    {blockBusy ? "Unblocking…" : "Unblock sender"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingBlock(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-300 hover:bg-surface-light transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM5.965 4.904l9.131 9.131a6.5 6.5 0 0 0-9.131-9.131Zm8.07 10.192L4.904 5.965a6.5 6.5 0 0 0 9.131 9.131Z" clipRule="evenodd" />
                    </svg>
                    Block sender
                  </button>
                )}
                <a
                  href={reportHref}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-surface-light transition-colors border-t border-border"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-muted" aria-hidden="true">
                    <path fillRule="evenodd" d="M3 2.25a.75.75 0 0 1 .75.75v.54l1.838-.46a9.75 9.75 0 0 1 6.725.738l.108.054a8.25 8.25 0 0 0 5.58.652l3.109-.732a.75.75 0 0 1 .917.81 47.784 47.784 0 0 0 .005 10.337.75.75 0 0 1-.574.812l-3.114.733a9.75 9.75 0 0 1-6.594-.77l-.108-.054a8.25 8.25 0 0 0-5.69-.625l-2.202.55V21a.75.75 0 0 1-1.5 0V3A.75.75 0 0 1 3 2.25Z" clipRule="evenodd" />
                  </svg>
                  Report conversation
                </a>
                {blockError && (
                  <p className="px-4 pb-3 text-xs text-red-400" role="alert">
                    {blockError}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ChatView
      roomId={roomId}
      slug={slug}
      displayName={displayName}
      conversationId={conversationId}
      isOwnerView
      header={header}
      variant="candy"
      starterTemplates={REPLY_TEMPLATES}
      inputPlaceholder="say something back 👀"
      composerDisabled={blocked}
      aboveComposer={
        blocked ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-light/70 px-3 py-2.5">
            <p className="text-xs text-slate-300">
              You blocked this sender. They can&apos;t message you.
            </p>
            <button
              type="button"
              onClick={() => updateBlocked(false)}
              disabled={blockBusy}
              className="shrink-0 text-xs font-semibold text-secondary hover:underline disabled:opacity-50"
            >
              {blockBusy ? "Unblocking…" : "Unblock"}
            </button>
          </div>
        ) : undefined
      }
    />
  );
}
