"use client";

import ChatView from "@/components/ChatView";

type Props = {
  roomId: string;
  slug: string;
  displayName: string;
};

export default function ChatRoom({ roomId, slug, displayName }: Props) {
  return (
    <ChatView
      roomId={roomId}
      slug={slug}
      displayName={displayName}
      inputPlaceholder={`Send ${displayName} an anonymous message…`}
    />
  );
}
