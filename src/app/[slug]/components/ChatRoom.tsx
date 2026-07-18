"use client";

import { useEffect, useState } from "react";
import ChatView from "@/components/ChatView";
import AnonymityExplainer from "@/components/AnonymityExplainer";
import { reportError } from "@/lib/report-error";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
};

export default function ChatRoom({ roomId, slug, displayName }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState(false);

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

  if (error) {
    return (
      <div className="flex items-center justify-center h-dvh bg-app-gradient px-6">
        <div className="anim-pop-in w-full max-w-sm rounded-[28px] bg-surface border border-border p-6 text-center flex flex-col items-center gap-3 shadow-2xl">
          <div className="text-3xl" aria-hidden="true">😵‍💫</div>
          <p className="font-display text-lg font-bold text-white">oops, something broke</p>
          <p className="text-sm text-muted">Please refresh the page to try again.</p>
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
      variant="candy"
      inputPlaceholder="say anything… it's anonymous 👀"
      aboveComposer={
        <AnonymityExplainer conversationId={conversationId} recipientName={displayName} />
      }
    />
  );
}
