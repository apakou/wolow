"use client";

import { useEffect, useRef, useState } from "react";
import ChatView from "@/components/ChatView";
import GoogleSignIn from "@/components/GoogleSignIn";
import { useAuth } from "@/hooks/use-auth";
import { reportError } from "@/lib/report-error";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
};

export default function ChatRoom({ roomId, slug, displayName }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const { user } = useAuth();
  const claimedRef = useRef(false);

  useEffect(() => {
    fetch(`/api/rooms/${slug}/conversations`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data.conversation_id) {
          setConversationId(data.conversation_id);
        } else {
          setError(true);
        }
      })
      .catch((err: unknown) => {
        reportError({ message: err instanceof Error ? err.message : "Failed to create conversation", endpoint: `/api/rooms/${slug}/conversations`, method: "POST", slug });
        setError(true);
      });
  }, [slug]);

  useEffect(() => {
    if (!user || !conversationId || claimedRef.current) return;
    claimedRef.current = true;

    void fetch("/api/claim-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, role: "sender" }),
    });
  }, [user, conversationId, slug]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-dvh bg-app-gradient text-muted text-sm">
        <div className="text-center flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-surface-light flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-red-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <p className="text-slate-300">Something went wrong. Please refresh.</p>
        </div>
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="flex items-center justify-center h-dvh bg-app-gradient">
        <div className="h-7 w-7 border-2 border-border border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ChatView
      roomId={roomId}
      slug={slug}
      displayName={displayName}
      conversationId={conversationId}
      inputPlaceholder={`Send ${displayName} an anonymous message…`}
      headerExtra={<GoogleSignIn returnTo={`/${slug}`} />}
    />
  );
}
