"use client";

/**
 * Dismissible banner shown to visitors above the composer, explaining how
 * their anonymity works. Previews the exact nickname/emoji the recipient
 * will see for this conversation, so the visitor can decide what to share.
 *
 * Dismissal is sticky per-conversation (localStorage).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getFunAnonymousName, getFunAnonymousEmoji } from "@/lib/fun-anonymous-name";

const DISMISS_PREFIX = "wolow:anonymity-explainer-dismissed:";

type Props = {
  conversationId: string;
  recipientName: string;
};

export default function AnonymityExplainer({ conversationId, recipientName }: Props) {
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash before localStorage check

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `${DISMISS_PREFIX}${conversationId}`;
    setDismissed(window.localStorage.getItem(key) === "1");
  }, [conversationId]);

  if (dismissed) return null;

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${DISMISS_PREFIX}${conversationId}`, "1");
    }
    setDismissed(true);
  }

  const previewName = getFunAnonymousName(conversationId);
  const previewEmoji = getFunAnonymousEmoji(conversationId);

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/10 p-3 flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/30 flex items-center justify-center">
        <span className="text-white text-lg leading-none" role="img" aria-label={previewName}>
          {previewEmoji}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white">
          You&apos;re anonymous to {recipientName}
        </p>
        <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
          They&apos;ll see you as <span className="font-semibold text-white">{previewName}</span>.
          Your IP and device aren&apos;t shared. Messages are end-to-end encrypted.{" "}
          <Link href="/help" target="_blank" className="text-accent underline underline-offset-2">
            Learn more
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-muted hover:text-white transition text-sm"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
