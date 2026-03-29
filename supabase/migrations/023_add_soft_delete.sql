-- ============================================================
-- 023_add_soft_delete.sql
-- Add soft-delete support: instead of deleting rooms/conversations,
-- mark them as archived with a deletion timestamp.
-- ============================================================

-- Add soft-delete columns to rooms
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add index for filtering active rooms
CREATE INDEX IF NOT EXISTS idx_rooms_is_archived
  ON public.rooms(is_archived)
  WHERE NOT is_archived;

-- Add soft-delete columns to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add index for filtering active conversations
CREATE INDEX IF NOT EXISTS idx_conversations_is_archived
  ON public.conversations(is_archived)
  WHERE NOT is_archived;

-- RPC to soft-delete a room (mark as archived instead of deleting)
CREATE OR REPLACE FUNCTION public.archive_room(p_room_id UUID)
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
     SET is_archived = true,
         deleted_at = NOW()
   WHERE id = p_room_id
     AND user_id = auth.uid();

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_room(UUID) TO authenticated;

-- RPC to soft-delete a room by slug for legacy token-based auth
CREATE OR REPLACE FUNCTION public.archive_room_by_slug(p_slug TEXT, p_owner_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE rooms
     SET is_archived = true,
         deleted_at = NOW()
   WHERE slug = p_slug
     AND owner_token = p_owner_token;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_room_by_slug(TEXT, TEXT) TO authenticated, anon;
