"use client";

import { useEffect, useState } from "react";
import ChatView from "@/components/ChatView";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
};

export default function OwnerInbox({ roomId, slug, displayName }: Props) {
  const [shareableLink, setShareableLink] = useState(`/${slug}`);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setShareableLink(`${window.location.origin}/${slug}`);
    setCanShare(!!navigator.share);
  }, [slug]);

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

  const header = (
    <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
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
    </div>
  );

  return (
    <ChatView
      roomId={roomId}
      slug={slug}
      displayName={displayName}
      header={header}
      inputPlaceholder="Reply to your anonymous messages…"
    />
  );
}
