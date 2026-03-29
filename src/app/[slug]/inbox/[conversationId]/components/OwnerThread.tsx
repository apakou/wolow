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
    <div className="px-4 py-3.5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <a href="/" className="inline-flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center shadow-lg shadow-accent/25">
            <svg width="15" height="15" viewBox="0 0 88 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M30.4 77.152C26.304 77.152 23.104 75.8293 20.8 73.184C18.5813 70.4533 17.0453 66.1013 16.192 60.128L13.504 41.696C13.4187 41.0133 13.248 40.544 12.992 40.288C12.736 40.032 12.352 39.904 11.84 39.904H8.384L8 38.496C9.70667 36.96 11.7547 35.7653 14.144 34.912C16.5333 33.9733 18.88 33.504 21.184 33.504C22.464 33.504 23.36 33.888 23.872 34.656C24.4693 35.424 24.9387 36.9173 25.28 39.136L28.608 62.176C29.2053 66.3573 29.888 69.216 30.656 70.752C31.424 72.288 32.576 73.056 34.112 73.056C36.5013 73.056 38.3787 71.6053 39.744 68.704C41.1947 65.7173 41.92 61.792 41.92 56.928C41.92 51.9787 41.28 46.9013 40 41.696C39.8293 41.0133 39.6587 40.544 39.488 40.288C39.3173 40.032 38.9333 39.904 38.336 39.904H35.008L34.624 38.496C36.2453 36.96 38.2507 35.7653 40.64 34.912C43.0293 33.9733 45.4187 33.504 47.808 33.504C49.0027 33.504 49.8987 33.9307 50.496 34.784C51.0933 35.552 51.52 37.0027 51.776 39.136L54.976 61.536C55.6587 66.144 56.384 69.216 57.152 70.752C58.0053 72.288 59.0293 73.056 60.224 73.056C62.528 73.056 64.3627 71.3493 65.728 67.936C67.1787 64.4373 67.904 59.9147 67.904 54.368C67.904 50.6133 67.52 47.3707 66.752 44.64C66.0693 41.824 64.9173 39.3493 63.296 37.216L62.272 35.808L63.168 34.784L73.92 33.504C74.176 36.832 74.304 39.776 74.304 42.336C74.304 53.2587 72.7253 61.792 69.568 67.936C66.496 74.08 62.0587 77.152 56.256 77.152C52.7573 77.152 50.112 76.256 48.32 74.464C46.528 72.672 45.0347 69.3867 43.84 64.608C42.1333 72.9707 37.6533 77.152 30.4 77.152Z" fill="white" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white tracking-wide">Wolow</span>
        </a>

        <a
          href={`/${slug}/inbox`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-light/50 px-3 py-1.5 text-xs text-slate-200"
          aria-label="Back to inbox"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          Inbox
        </a>
      </div>

      <div className="min-w-0">
        <p className="text-sm font-bold text-white truncate">{conversationLabel}</p>
        <p className="text-xs text-muted">{displayName}&apos;s inbox</p>
      </div>
    </div>
  );

  const mobileBottomNav = (
    <div className="grid grid-cols-1 gap-2">
      <a
        href="/"
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-light px-3 py-2 text-xs font-medium text-slate-200"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M9.69 2.22a.75.75 0 0 1 .62 0l6.5 3A.75.75 0 0 1 17.25 5.9v8.2a.75.75 0 0 1-.44.68l-6.5 3a.75.75 0 0 1-.62 0l-6.5-3a.75.75 0 0 1-.44-.68V5.9a.75.75 0 0 1 .44-.68l6.5-3Z" />
        </svg>
        Home
      </a>
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
      mobileBottomNav={mobileBottomNav}
    />
  );
}
