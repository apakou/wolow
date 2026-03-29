-- ============================================================
-- 019_set_owner_public_key_rpc.sql
-- RPC to safely set the owner's public key on a room.
-- Handles set_config('app.owner_token', ...) internally so the
-- RLS policy "rooms_update_owner_only" is satisfied.
-- ============================================================

CREATE OR REPLACE FUNCTION set_owner_public_key(
  p_room_id UUID,
  p_owner_token TEXT,
  p_public_key JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set the session variable so RLS allows the UPDATE
  PERFORM set_config('app.owner_token', p_owner_token, true);

  UPDATE rooms
     SET owner_public_key = p_public_key
   WHERE id = p_room_id
     AND owner_token = p_owner_token
     AND owner_public_key IS NULL;

  RETURN FOUND;
END;
$$;
