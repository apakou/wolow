-- ============================================================
-- 004_add_conversations_update_policy.sql
-- Adds UPDATE policy to conversations table so that:
--   1. upsert (ON CONFLICT DO UPDATE) works for returning senders
--   2. owner can mark conversations as read (PATCH endpoint)
-- ============================================================

create policy "conversations_update_all"
  on conversations for update
  using (true)
  with check (true);
