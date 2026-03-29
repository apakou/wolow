-- Revert migration 014: undo media_url column, storage bucket, and RPC change

-- 1. Drop the 8-param version of send_message_secure
DROP FUNCTION IF EXISTS send_message_secure(TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID, TEXT);

-- 2. Restore the original 7-param version from migration 011
CREATE OR REPLACE FUNCTION send_message_secure(
  p_slug                TEXT,
  p_conversation_id     UUID,
  p_content             TEXT,
  p_reply_to_message_id UUID DEFAULT NULL,
  p_owner_token         TEXT DEFAULT NULL,
  p_encrypted_content   TEXT DEFAULT NULL,
  p_sender_public_key_id UUID DEFAULT NULL
)
RETURNS TABLE(
  id                    UUID,
  room_id               UUID,
  conversation_id       UUID,
  content               TEXT,
  is_owner              BOOLEAN,
  created_at            TIMESTAMPTZ,
  reply_to_message_id   UUID,
  encrypted_content     TEXT,
  sender_public_key_id  UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id      UUID;
  v_owner_token  TEXT;
  v_is_owner     BOOLEAN := FALSE;
  v_target_conv  UUID;
BEGIN
  SELECT r.id, r.owner_token
  INTO v_room_id, v_owner_token
  FROM rooms r
  WHERE r.slug = p_slug;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF p_owner_token IS NOT NULL AND p_owner_token = v_owner_token THEN
    v_is_owner := TRUE;
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_REQUIRED';
  END IF;

  PERFORM 1
  FROM conversations c
  WHERE c.id = p_conversation_id
    AND c.room_id = v_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND';
  END IF;

  IF p_reply_to_message_id IS NOT NULL THEN
    SELECT m.conversation_id
    INTO v_target_conv
    FROM messages m
    WHERE m.id = p_reply_to_message_id
      AND m.room_id = v_room_id;

    IF v_target_conv IS NULL THEN
      RAISE EXCEPTION 'REPLY_TARGET_NOT_FOUND';
    END IF;

    IF v_target_conv <> p_conversation_id THEN
      RAISE EXCEPTION 'REPLY_TARGET_WRONG_CONVERSATION';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO messages (
    room_id,
    content,
    is_owner,
    conversation_id,
    reply_to_message_id,
    encrypted_content,
    sender_public_key_id
  )
  VALUES (
    v_room_id,
    p_content,
    v_is_owner,
    p_conversation_id,
    p_reply_to_message_id,
    p_encrypted_content,
    p_sender_public_key_id
  )
  RETURNING
    messages.id,
    messages.room_id,
    messages.conversation_id,
    messages.content,
    messages.is_owner,
    messages.created_at,
    messages.reply_to_message_id,
    messages.encrypted_content,
    messages.sender_public_key_id;
END;
$$;

GRANT EXECUTE ON FUNCTION send_message_secure(TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID) TO anon;

-- 3. Remove storage policies
DROP POLICY IF EXISTS "chat_media_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_public_read" ON storage.objects;

-- 4. Mark bucket as non-public (cannot delete buckets via SQL; leave it inert)
UPDATE storage.buckets SET public = false WHERE id = 'chat-media';

-- 5. Drop the media_url column
ALTER TABLE messages DROP COLUMN IF EXISTS media_url;
