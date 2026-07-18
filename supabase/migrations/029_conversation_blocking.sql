-- 029: Allow room owners to block a conversation.
--
-- blocked_at NULL  = conversation active (default)
-- blocked_at SET   = owner blocked the sender; the messages API rejects all
--                    new inserts for this conversation until unblocked.
alter table conversations
  add column if not exists blocked_at timestamptz;

comment on column conversations.blocked_at is
  'When set, the room owner has blocked this sender; message inserts are rejected at the API layer.';
