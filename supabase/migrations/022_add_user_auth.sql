-- ============================================================
-- 022_add_user_auth.sql
-- Additive migration to support linking anonymous sessions to
-- authenticated users (e.g. Google OAuth) without data loss.
-- ============================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_user_id
  ON public.rooms(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
  ON public.conversations(user_id)
  WHERE user_id IS NOT NULL;

-- Claim sender conversations after auth, based on httpOnly sender token.
CREATE OR REPLACE FUNCTION public.claim_conversation(p_sender_token TEXT)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  UPDATE conversations
  SET user_id = auth.uid()
  WHERE sender_token = p_sender_token
    AND user_id IS NULL
  RETURNING id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_conversation(TEXT) TO authenticated;

-- Claim owner room after auth, based on httpOnly owner token.
CREATE OR REPLACE FUNCTION public.claim_room(p_slug TEXT, p_owner_token TEXT)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  UPDATE rooms
  SET user_id = auth.uid()
  WHERE slug = p_slug
    AND owner_token = p_owner_token
    AND user_id IS NULL
  RETURNING id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_room(TEXT, TEXT) TO authenticated;

-- Allows an authenticated owner to set the room public key when the room is
-- already linked to their account, without relying on the legacy owner token.
CREATE OR REPLACE FUNCTION public.set_owner_public_key_for_user(
  p_room_id UUID,
  p_public_key JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  UPDATE rooms
     SET owner_public_key = p_public_key
   WHERE id = p_room_id
     AND user_id = auth.uid()
     AND owner_public_key IS NULL;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_owner_public_key_for_user(UUID, JSONB) TO authenticated;
