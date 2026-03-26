"use client";

import { useEffect } from "react";
import ChatView from "@/components/ChatView";

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
  const header = (
    <div className="px-4 py-3.5 flex items-center gap-3">
      <a
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
      </a>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-white truncate">{conversationLabel}</p>
        <p className="text-xs text-muted">{displayName}&apos;s inbox</p>
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
      inputPlaceholder="Reply to this conversation…"
    />
  );
}
