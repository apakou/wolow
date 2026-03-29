-- ============================================================
-- 015_restore_permissive_rls.sql
-- Reverts 014_room_participants_and_rls.sql:
-- Drops participant-based RLS (requires auth.uid() which is
-- always null in this anonymous token-based app) and restores
-- the original permissive policies.
-- ============================================================

-- 1. Drop participant-based policies on rooms
DROP POLICY IF EXISTS "rooms_select_participant" ON rooms;
DROP POLICY IF EXISTS "rooms_update_owner_participant" ON rooms;

-- 2. Restore original permissive rooms policies
CREATE POLICY "rooms_select_by_slug"
  ON rooms FOR SELECT
  USING (true);

CREATE POLICY "rooms_update_owner_only"
  ON rooms FOR UPDATE
  USING (owner_token = current_setting('app.owner_token', true));

-- 3. Drop participant-based policies on messages
DROP POLICY IF EXISTS "messages_select_participant" ON messages;
DROP POLICY IF EXISTS "messages_insert_participant" ON messages;

-- 4. Restore original permissive messages policies
CREATE POLICY "messages_select_all"
  ON messages FOR SELECT
  USING (true);

CREATE POLICY "messages_insert_anyone"
  ON messages FOR INSERT
  WITH CHECK (true);

-- 5. Drop participant-based policies on room_participants
DROP POLICY IF EXISTS "room_participants_select_own_rooms" ON room_participants;
DROP POLICY IF EXISTS "room_participants_insert_self" ON room_participants;
DROP POLICY IF EXISTS "room_participants_delete_self" ON room_participants;

-- 6. Drop the room_participants table (unused — app uses anonymous tokens)
DROP TABLE IF EXISTS room_participants CASCADE;