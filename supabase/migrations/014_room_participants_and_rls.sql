-- Create room_participants linking table and tighten RLS on rooms & messages
-- to participant-based access control.

-- 1. Room participants table
CREATE TABLE IF NOT EXISTS room_participants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;

-- Participants can see who else is in their rooms
CREATE POLICY "room_participants_select_own_rooms"
  ON room_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = room_participants.room_id
        AND rp.user_id = auth.uid()
    )
  );

-- Authenticated users can join rooms (insert themselves)
CREATE POLICY "room_participants_insert_self"
  ON room_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only remove themselves
CREATE POLICY "room_participants_delete_self"
  ON room_participants FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 2. Tighten rooms table — participant-based SELECT & UPDATE
-- ============================================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "rooms_select_by_slug" ON rooms;
DROP POLICY IF EXISTS "rooms_update_owner_only" ON rooms;

-- SELECT: only participants can view rooms they belong to
CREATE POLICY "rooms_select_participant"
  ON rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = rooms.id
        AND rp.user_id = auth.uid()
    )
  );

-- UPDATE: only the room owner (participant with role 'owner') can update
CREATE POLICY "rooms_update_owner_participant"
  ON rooms FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = rooms.id
        AND rp.user_id = auth.uid()
        AND rp.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = rooms.id
        AND rp.user_id = auth.uid()
        AND rp.role = 'owner'
    )
  );

-- Keep rooms_insert_anyone — room creation is rate-limited at API layer
-- (new rooms still need an INSERT before participants can be added)


-- ============================================================
-- 3. Tighten messages table — participant-based SELECT & INSERT
-- ============================================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "messages_select_all" ON messages;
DROP POLICY IF EXISTS "messages_insert_anyone" ON messages;

-- SELECT: only participants of the room can read messages
CREATE POLICY "messages_select_participant"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = messages.room_id
        AND rp.user_id = auth.uid()
    )
  );

-- INSERT: only participants of the room can send messages
CREATE POLICY "messages_insert_participant"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM room_participants rp
      WHERE rp.room_id = messages.room_id
        AND rp.user_id = auth.uid()
    )
  );


-- ============================================================
-- 4. user_public_keys — already configured in migration 010
--    SELECT: anyone (public keys are shareable)
--    INSERT/UPDATE/DELETE: auth.uid() = user_id
--    No changes needed.
-- ============================================================
