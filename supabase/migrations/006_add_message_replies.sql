-- ============================================================
-- 006_add_message_replies.sql
-- Adds per-message reply linkage for threaded-style replies.
-- ============================================================

alter table messages
  add column if not exists reply_to_message_id uuid
  references messages (id) on delete set null;

create index if not exists messages_reply_to_message_id_idx
  on messages (reply_to_message_id);