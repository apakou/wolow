-- 026_add_key_metadata.sql
--
-- Adds metadata columns for owner key rotation tracking and fingerprint display.
-- Used by the Settings → Key Status card so owners can verify their local key
-- matches the one the server holds (catches bad backups / wrong-device issues).
--
-- Also extends `set_owner_public_key` to accept fingerprint + rotation stamp
-- in a single round-trip, so the API route doesn't need a second UPDATE that
-- would fail the `app.owner_token` RLS check.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS owner_public_key_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_key_fingerprint text;

COMMENT ON COLUMN rooms.owner_public_key_rotated_at IS
  'Timestamp of the most recent owner public key rotation (null = original key).';

COMMENT ON COLUMN rooms.owner_key_fingerprint IS
  'Human-readable 4-word fingerprint of the current owner public key (Wolow-themed wordlist).';

-- Replace the RPC to also persist fingerprint + (optional) rotation timestamp.
-- Keeps the SECURITY DEFINER + owner_token gate from migration 025.
CREATE OR REPLACE FUNCTION set_owner_public_key(
  p_room_id UUID,
  p_owner_token TEXT,
  p_public_key JSONB,
  p_fingerprint TEXT DEFAULT NULL,
  p_mark_rotated BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.owner_token', p_owner_token, true);

  UPDATE rooms
     SET owner_public_key = p_public_key,
         owner_key_fingerprint = COALESCE(p_fingerprint, owner_key_fingerprint),
         owner_public_key_rotated_at = CASE
           WHEN p_mark_rotated THEN now()
           ELSE owner_public_key_rotated_at
         END
   WHERE id = p_room_id
     AND owner_token = p_owner_token;

  RETURN FOUND;
END;
$$;
