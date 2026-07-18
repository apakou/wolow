"use client";

/**
 * Banner offering an anonymous sender to save their conversation by upgrading
 * to a permanent account. `linkIdentity` keeps the same Supabase user id, so
 * the conversation (and its E2EE keys) survive the upgrade untouched.
 *
 * Shown once the visitor has sent at least one message. Dismissal is sticky
 * per conversation, but the prompt returns one more time after the owner
 * replies (the moment the chat becomes worth keeping).
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const DISMISS_PREFIX = "wolow:save-chat-dismissed:";

type Props = {
  slug: string;
  conversationId: string;
  recipientName: string;
  /** True once the room owner has replied in this conversation */
  ownerReplied: boolean;
};

function readDismissCount(conversationId: string): number {
  if (typeof window === "undefined") return 2;
  const raw = window.localStorage.getItem(`${DISMISS_PREFIX}${conversationId}`);
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default function SaveChatPrompt({ slug, conversationId, recipientName, ownerReplied }: Props) {
  const [dismissCount, setDismissCount] = useState(() => readDismissCount(conversationId));
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(false);

  // 0 = never dismissed; 1 = dismissed before any owner reply (one re-show
  // allowed once the owner replies); 2 = dismissed for good.
  const visible = dismissCount === 0 || (dismissCount === 1 && ownerReplied);
  if (!visible) return null;

  function dismiss() {
    const next = ownerReplied ? 2 : 1;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`${DISMISS_PREFIX}${conversationId}`, String(next));
    }
    setDismissCount(next);
  }

  async function handleSave() {
    if (linking) return;
    setLinking(true);
    setLinkError(false);
    const supabase = createClient();
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(`/${slug}`)}`,
      },
    });
    if (error) {
      // Redirect never started surface it and let the user retry
      setLinking(false);
      setLinkError(true);
    }
    // On success the browser navigates away; keep the button in its busy state.
  }

  return (
    <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-3 flex items-start gap-3" role="status">
      <div className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-md border border-white/30 flex items-center justify-center">
        <span className="text-lg leading-none" aria-hidden="true">💾</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white">Don&apos;t lose this chat</p>
        <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
          Your anonymous chat lives only in this browser. Save it with a free
          account {recipientName} still won&apos;t see who you are.
        </p>
        {linkError && (
          <p className="text-[11px] text-red-300 mt-1" role="alert">
            Couldn&apos;t start sign-in. Please try again.
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={linking}
            className="btn-squish rounded-full bg-secondary px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
          >
            {linking ? "Connecting…" : "Save my chats"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium text-muted hover:text-white transition"
          >
            Not now
          </button>
        </div>
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
