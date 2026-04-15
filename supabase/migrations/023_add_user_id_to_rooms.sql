-- ============================================================
-- 023_add_user_id_to_rooms.sql
-- Links rooms to authenticated Supabase Auth users.
-- Nullable so rooms created anonymously (old/no-auth) still work.
-- ============================================================

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rooms_user_id_idx ON rooms (user_id);
