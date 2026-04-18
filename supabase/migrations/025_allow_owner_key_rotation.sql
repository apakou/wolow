-- ============================================================
-- 025_allow_owner_key_rotation.sql
-- Allow the owner to rotate their E2EE public key.
-- Previously the RPC refused to overwrite an existing key,
-- which permanently broke decryption when the owner lost their
-- private key (cleared browser data, new device, Safari ITP, etc.).
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
     AND owner_token = p_owner_token;

  RETURN FOUND;
END;
$$;
