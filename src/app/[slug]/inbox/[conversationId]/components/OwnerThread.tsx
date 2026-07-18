"use client";

import { useEffect } from "react";
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
};

export default function OwnerThread({
  roomId,
  slug,
  displayName,
  conversationId,
  conversationLabel,
}: Props) {
  // Mark conversation as read when the owner opens it
  useEffect(() => {
    fetch(`/api/rooms/${slug}/conversations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  }, [slug, conversationId]);

  // Compact single row — mirrors the sender header anatomy exactly:
  // back · avatar · name + trust line, so both sides feel like one app.
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
    />
  );
}
