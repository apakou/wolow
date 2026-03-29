-- ============================================================
-- 003_add_owner_last_read.sql
-- Tracks when the owner last viewed each conversation,
-- enabling unread-message indicators in the inbox.
-- ============================================================

alter table conversations
  add column owner_last_read_at timestamptz;
