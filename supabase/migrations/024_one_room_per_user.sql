-- ============================================================
-- 024_one_room_per_user.sql
-- Enforces one permanent room per user and migrates conversations
-- from anonymous sender_token to authenticated sender_user_id.
-- Senders must be signed in, but remain anonymous to room owners.
-- ============================================================

-- ──────────────────────────────────────────
-- Rooms: deduplicate then enforce one room per user
-- ──────────────────────────────────────────

-- Keep only the oldest room per user; delete all newer duplicates.
DELETE FROM rooms
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) AS rn
    FROM rooms
    WHERE user_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

ALTER TABLE rooms
  ADD CONSTRAINT rooms_user_id_unique UNIQUE (user_id);

-- ──────────────────────────────────────────
-- Conversations: replace sender_token with sender_user_id
-- ──────────────────────────────────────────

-- 1. Add the new authenticated sender column
ALTER TABLE conversations
  ADD COLUMN sender_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Drop the old sender_token unique constraint
ALTER TABLE conversations
  DROP CONSTRAINT conversations_room_sender_unique;

-- 3. Drop the sender_token column (all existing conversations become orphaned)
ALTER TABLE conversations
  DROP COLUMN sender_token;

-- 4. Enforce one conversation per (room, authenticated sender)
--    Standard UNIQUE on two non-nullable future values; NULLs are allowed
--    until the column is populated, but new inserts will always provide it.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_room_sender_user_unique
  UNIQUE (room_id, sender_user_id);

-- 5. Index for fast "sent by me" lookups (/sent page)
CREATE INDEX conversations_sender_user_id_idx
  ON conversations (sender_user_id);

-- ──────────────────────────────────────────
-- RLS: require auth for conversation inserts
-- ──────────────────────────────────────────
DROP POLICY IF EXISTS "conversations_insert_all" ON conversations;

CREATE POLICY "conversations_insert_auth"
  ON conversations FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = sender_user_id
  );
