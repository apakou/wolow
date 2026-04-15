Description: Implements WhatsApp-like fluid realtime messaging using Supabase Realtime WebSocket channels with optimistic UI, delivery status, reconnection handling, and broadcast events.

• Purpose: Make chat messaging feel instant and responsive — messages appear immediately on send, delivery/read status is tracked, and the connection gracefully handles drops.

• Inputs: roomId (string), conversationId (string), role ("owner" | "visitor"), e2ee hooks from use-e2ee.ts.

• Outputs: React hooks and patterns for fluid realtime messaging with optimistic updates, delivery receipts, and connection resilience.

---

## Architecture Overview

Wolow uses **Supabase Realtime** (WebSocket-based) for all realtime features. There are two channel types:

1. **postgres_changes** — triggered when rows are inserted/updated/deleted in the database. Used for durable message delivery.
2. **broadcast** — ephemeral events sent directly between connected clients via the Supabase Realtime server. Used for typing indicators, presence, and delivery receipts.

The goal is WhatsApp-like UX:
- Messages appear instantly (optimistic UI)
- Double-check marks for delivered/read
- Typing indicators
- Seamless reconnection on network drop
- No duplicate messages

---

## Core Patterns

### 1. Optimistic Message Rendering

Messages must appear in the UI **before** the server confirms insertion. This eliminates perceived latency.

```typescript
// Pattern: Optimistic insert with reconciliation
const [messages, setMessages] = useState<Message[]>([]);

async function sendMessage(content: string) {
  const optimisticId = crypto.randomUUID();
  const optimisticMsg: Message = {
    id: optimisticId,
    content,
    created_at: new Date().toISOString(),
    is_owner: role === "owner",
    status: "sending", // "sending" → "sent" → "delivered" → "read"
    _optimistic: true,
  };

  // 1. Render immediately
  setMessages((prev) => [...prev, optimisticMsg]);
  scrollToBottom();

  try {
    // 2. Encrypt if E2EE is active
    const payload = e2ee.isReady
      ? await e2ee.encrypt(content)
      : { content };

    // 3. Send to server
    const res = await fetch(`/api/rooms/${slug}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, optimistic_id: optimisticId }),
    });

    if (!res.ok) throw new Error("Send failed");
    const serverMsg = await res.json();

    // 4. Reconcile: replace optimistic message with server-confirmed one
    setMessages((prev) =>
      prev.map((m) =>
        m.id === optimisticId
          ? { ...serverMsg, status: "sent", _optimistic: false }
          : m
      )
    );
  } catch (err) {
    // 5. Mark as failed — allow retry
    setMessages((prev) =>
      prev.map((m) =>
        m.id === optimisticId ? { ...m, status: "failed" } : m
      )
    );
  }
}
```

**Rules:**
- Always generate a client-side UUID for optimistic messages
- Pass `optimistic_id` to the server so the realtime subscription can deduplicate
- Never remove a failed message — show retry affordance
- Status progression: `sending` → `sent` → `delivered` → `read` → or `failed`

### 2. Channel Subscription with Deduplication

When a message is inserted in the DB, Supabase Realtime fires a postgres_changes event. The client must deduplicate against optimistic messages.

```typescript
useEffect(() => {
  const supabase = createBrowserClient();

  const channel = supabase
    .channel(`chat:${conversationId ?? roomId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: conversationId
          ? `conversation_id=eq.${conversationId}`
          : `room_id=eq.${roomId}`,
      },
      async (payload) => {
        const newMsg = payload.new as Message;

        // Skip messages sent by this client (already rendered optimistically)
        if (newMsg.optimistic_id) {
          setMessages((prev) => {
            const exists = prev.some(
              (m) => m.id === newMsg.optimistic_id || m.id === newMsg.id
            );
            if (exists) {
              // Reconcile optimistic → server
              return prev.map((m) =>
                m.id === newMsg.optimistic_id
                  ? { ...newMsg, status: "sent", _optimistic: false }
                  : m
              );
            }
            return [...prev, { ...newMsg, status: "sent" }];
          });
        } else {
          // Message from another participant
          const decrypted = e2ee.isReady
            ? await e2ee.decrypt(newMsg.encrypted_content, newMsg.iv, newMsg.sender_public_key)
            : newMsg;

          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, { ...decrypted, status: "sent" }];
          });

          // Send delivery receipt via broadcast
          channel.send({
            type: "broadcast",
            event: "delivery_receipt",
            payload: { message_id: newMsg.id, status: "delivered" },
          });
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [roomId, conversationId]);
```

**Rules:**
- Always check for duplicates by both `optimistic_id` and `id`
- Decrypt incoming messages from other participants
- Send delivery receipts via broadcast (not DB writes) to avoid unnecessary load
- Clean up channels in the useEffect return

### 3. Delivery & Read Receipts via Broadcast

Use Supabase broadcast channels for ephemeral delivery/read status — no database writes needed.

```typescript
// Subscribe to receipt events on the same channel
channel.on("broadcast", { event: "delivery_receipt" }, (payload) => {
  const { message_id, status } = payload.payload;
  setMessages((prev) =>
    prev.map((m) =>
      m.id === message_id ? { ...m, status } : m
    )
  );
});

channel.on("broadcast", { event: "read_receipt" }, (payload) => {
  const { up_to_message_id } = payload.payload;
  setMessages((prev) =>
    prev.map((m) => {
      if (m.created_at <= up_to_message_id && m.status !== "read") {
        return { ...m, status: "read" };
      }
      return m;
    })
  );
});

// Send read receipt when conversation is visible
function markAsRead(latestMessageId: string) {
  channel.send({
    type: "broadcast",
    event: "read_receipt",
    payload: { up_to_message_id: latestMessageId },
  });
}
```

**Status icons (WhatsApp-style):**
- `sending`: Single grey clock icon ⏳
- `sent`: Single grey check ✓
- `delivered`: Double grey checks ✓✓
- `read`: Double blue checks ✓✓ (blue)
- `failed`: Red exclamation with retry button

### 4. Typing Indicators via Broadcast

```typescript
// Send typing event (debounced)
const sendTyping = useMemo(
  () =>
    debounce(() => {
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: { user: displayName },
      });
    }, 300),
  [channel, displayName]
);

// Listen for typing events
const [typingUsers, setTypingUsers] = useState<Map<string, number>>(new Map());

channel.on("broadcast", { event: "typing" }, (payload) => {
  const { user } = payload.payload;
  setTypingUsers((prev) => {
    const next = new Map(prev);
    next.set(user, Date.now());
    return next;
  });
});

// Clear stale typing indicators every 3 seconds
useEffect(() => {
  const interval = setInterval(() => {
    setTypingUsers((prev) => {
      const now = Date.now();
      const next = new Map(prev);
      for (const [user, timestamp] of next) {
        if (now - timestamp > 3000) next.delete(user);
      }
      return prev.size !== next.size ? next : prev;
    });
  }, 1000);
  return () => clearInterval(interval);
}, []);
```

### 5. Connection Resilience & Reconnection

Handle WebSocket disconnections gracefully — critical for mobile users.

```typescript
// Monitor channel status
channel.subscribe((status) => {
  switch (status) {
    case "SUBSCRIBED":
      setConnectionStatus("connected");
      // Fetch any messages missed during disconnection
      fetchMessagesSince(lastMessageTimestamp);
      break;
    case "CHANNEL_ERROR":
      setConnectionStatus("error");
      break;
    case "TIMED_OUT":
      setConnectionStatus("reconnecting");
      break;
    case "CLOSED":
      setConnectionStatus("disconnected");
      break;
  }
});

// Gap-fill: fetch messages that arrived while disconnected
async function fetchMessagesSince(since: string) {
  const res = await fetch(
    `/api/rooms/${slug}/messages?since=${encodeURIComponent(since)}`
  );
  const missed = await res.json();

  setMessages((prev) => {
    const existingIds = new Set(prev.map((m) => m.id));
    const newMsgs = missed.filter((m: Message) => !existingIds.has(m.id));
    return [...prev, ...newMsgs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  });
}
```

**Rules:**
- Always track `lastMessageTimestamp` so you can gap-fill after reconnection
- Show a subtle banner when connection is degraded ("Connecting...")
- Never silently drop messages — always reconcile on reconnect
- Supabase Realtime auto-reconnects, but you must refetch missed data

### 6. Single Channel per Conversation

Consolidate all events (messages, reactions, receipts, typing, presence) onto a **single Supabase channel** per conversation to minimize WebSocket connections.

```typescript
const channel = supabase
  .channel(`chat:${conversationId}`, {
    config: { broadcast: { self: false } }, // Don't receive own broadcasts
  })
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, handleNewMessage)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions", filter: `conversation_id=eq.${conversationId}` }, handleNewReaction)
  .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions", filter: `conversation_id=eq.${conversationId}` }, handleDeleteReaction)
  .on("broadcast", { event: "typing" }, handleTyping)
  .on("broadcast", { event: "delivery_receipt" }, handleDeliveryReceipt)
  .on("broadcast", { event: "read_receipt" }, handleReadReceipt)
  .on("broadcast", { event: "presence" }, handlePresence)
  .subscribe(handleChannelStatus);
```

**Rules:**
- One channel per active conversation — never open multiple channels for the same conversation
- Set `broadcast: { self: false }` to avoid processing your own broadcast events
- Unsubscribe in cleanup: `supabase.removeChannel(channel)`

### 7. Message Queue for Offline/Poor Connection

Queue messages locally when the connection is down, send them when reconnected.

```typescript
const messageQueue = useRef<QueuedMessage[]>([]);

async function sendMessage(content: string) {
  const msg = createOptimisticMessage(content);
  setMessages((prev) => [...prev, msg]);

  if (connectionStatus !== "connected") {
    messageQueue.current.push(msg);
    return;
  }

  await submitMessage(msg);
}

// Flush queue on reconnection
useEffect(() => {
  if (connectionStatus === "connected" && messageQueue.current.length > 0) {
    const queue = [...messageQueue.current];
    messageQueue.current = [];
    queue.forEach((msg) => submitMessage(msg));
  }
}, [connectionStatus]);
```

---

## Integration with Existing Codebase

### Files to Modify
- `src/components/ChatView.tsx` — Add optimistic updates, delivery status, typing indicators, reconnection handling
- `src/app/[slug]/inbox/components/OwnerInbox.tsx` — Add realtime unread count updates

### Files to Create (if extracting hooks)
- `src/lib/realtime/use-realtime-messages.ts` — Hook for message subscription + optimistic updates
- `src/lib/realtime/use-typing-indicator.ts` — Hook for typing broadcast
- `src/lib/realtime/use-delivery-status.ts` — Hook for delivery/read receipts
- `src/lib/realtime/use-connection-status.ts` — Hook for monitoring WebSocket health

### Database Changes Needed
- Add `status` column to messages table (optional — only if persisting delivery status)
- OR handle status purely client-side via broadcast (recommended for MVP)

### CSP Policy
The existing CSP in `next.config.ts` already allows WebSocket connections:
- Dev: `ws://127.0.0.1:54321` and `wss://*.supabase.co`
- Prod: `wss://*.supabase.co`

---

## Performance Guidelines

1. **Batch state updates** — Use functional setState to avoid stale closures
2. **Debounce typing events** — Max 1 broadcast per 300ms
3. **Virtualize long message lists** — Use `react-window` or `@tanstack/react-virtual` for 500+ messages
4. **Limit channel listeners** — Unsubscribe from channels not in view
5. **Avoid re-renders** — Memoize message components with `React.memo` and stable keys
6. **IndexedDB for message cache** — Store decrypted messages locally for instant load on revisit

---

## Security Considerations

1. **Never trust broadcast payloads** — Validate sender identity server-side when needed
2. **E2EE must be applied before optimistic rendering** — Encrypt content before sending, store encrypted version
3. **Rate-limit broadcast events** — Client-side throttle to prevent abuse
4. **Don't expose message IDs in broadcast receipts** if IDs are sequential (use UUIDs — already in place)
5. **Sanitize all message content** before rendering — XSS prevention applies to realtime messages too

---

## Anti-Patterns to Avoid

- ❌ Opening a new channel per message or per event type
- ❌ Storing delivery/read status in the database for every message (use broadcast for ephemeral status)
- ❌ Polling for new messages instead of using realtime subscriptions
- ❌ Removing failed messages from the UI (always show retry option)
- ❌ Ignoring channel status changes (always handle reconnection)
- ❌ Using `setTimeout` for reconnection (Supabase handles this — just gap-fill on reconnect)
