"use client";

import { useEffect, useState } from "react";
import ChatView from "@/components/ChatView";

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
      .catch(() => setError(true));
  }, [slug]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-dvh bg-zinc-950 text-zinc-400 text-sm">
        Something went wrong. Please refresh.
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="flex items-center justify-center h-dvh bg-zinc-950">
        <div className="h-6 w-6 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
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
    />
  );
}
