"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ChatView from "@/components/ChatView";
import AnonymityExplainer from "@/components/AnonymityExplainer";
import SaveChatPrompt from "./SaveChatPrompt";
import { createClient } from "@/lib/supabase/client";
import { reportError } from "@/lib/report-error";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
  /** True when the server already saw a Supabase session (Google or anonymous). */
  hasSession: boolean;
  /** True when the visitor has no permanent account (no session yet, or anonymous session). */
  isAnonymous: boolean;
};

export default function ChatRoom({ roomId, slug, displayName, hasSession, isAnonymous }: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [activity, setActivity] = useState({ visitorMessages: 0, ownerMessages: 0 });

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Visitors don't need an account: if there is no session yet, silently
        // create an anonymous one so RLS/conversations/E2EE keep working.
        // Re-check locally on retries so a second attempt never creates a
        // second anonymous user after a transient conversation failure.
        if (!hasSession) {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            const { error: signInError } = await supabase.auth.signInAnonymously();
            if (signInError) {
              // Anonymous sessions unavailable (disabled or per-IP signup
              // rate limit). Degrade to the explicit Google sign-in screen
              // instead of a dead-end error card.
              reportError({ message: `Anonymous sign-in failed: ${signInError.message}`, endpoint: `/${slug}`, slug });
              if (!cancelled) router.replace(`/?next=${encodeURIComponent(`/${slug}`)}`);
              return;
            }
          }
        }

        const res = await fetch(`/api/rooms/${slug}/conversations`, { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
        if (data.conversation_id) {
          setConversationId(data.conversation_id);
        } else {
          setError(true);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        reportError({ message: err instanceof Error ? err.message : "Failed to start conversation", endpoint: `/api/rooms/${slug}/conversations`, method: "POST", slug });
        setError(true);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [slug, attempt, hasSession, router]);

  const handleActivity = useCallback(
    (next: { visitorMessages: number; ownerMessages: number }) => setActivity(next),
    []
  );

  if (error) {
    return (
      <div className="flex items-center justify-center h-dvh bg-app-gradient px-6">
        <div className="anim-pop-in w-full max-w-sm rounded-[28px] bg-surface border border-border p-6 text-center flex flex-col items-center gap-3 shadow-2xl">
          <div className="text-3xl" aria-hidden="true">😵‍💫</div>
          <p className="font-display text-lg font-bold text-white">oops, something broke</p>
          <p className="text-sm text-muted">Check your connection and give it another go.</p>
          <button
            type="button"
            onClick={() => {
              setError(false);
              setAttempt((a) => a + 1);
            }}
            className="btn-squish mt-1 w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // No full-page spinner while the conversation initializes: the chat shell
  // (header + composer) renders instantly and only the message list the
  // component whose state is actually loading shows a skeleton.
  return (
    <ChatView
      roomId={roomId}
      slug={slug}
      displayName={displayName}
      conversationId={conversationId ?? undefined}
      conversationPending={!conversationId}
      variant="candy"
      inputPlaceholder="say anything… it's anonymous 👀"
      onActivity={handleActivity}
      aboveComposer={
        <>
          {isAnonymous && conversationId && activity.visitorMessages > 0 && (
            <SaveChatPrompt
              slug={slug}
              conversationId={conversationId}
              recipientName={displayName}
              ownerReplied={activity.ownerMessages > 0}
            />
          )}
          {conversationId && (
            <AnonymityExplainer conversationId={conversationId} recipientName={displayName} />
          )}
          {isAnonymous && activity.visitorMessages === 0 && (
            <p className="text-center text-[11px] text-muted">
              This is your link?{" "}
              <Link
                href={`/?next=${encodeURIComponent(`/${slug}/inbox`)}`}
                className="text-secondary underline underline-offset-2"
              >
                Sign in to open your inbox
              </Link>
            </p>
          )}
        </>
      }
    />
  );
}
