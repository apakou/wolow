-- One-roundtrip secure message send path.
-- Validates room, conversation ownership, optional reply target, and inserts.

CREATE OR REPLACE FUNCTION send_message_secure(
  p_slug                TEXT,
  p_conversation_id     UUID,
  p_content             TEXT,
  p_reply_to_message_id UUID DEFAULT NULL,
  p_owner_token         TEXT DEFAULT NULL
)
RETURNS TABLE(
  id                  UUID,
  room_id             UUID,
  conversation_id     UUID,
  content             TEXT,
  is_owner            BOOLEAN,
  created_at          TIMESTAMPTZ,
  reply_to_message_id UUID
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
    reply_to_message_id
  )
  VALUES (
    v_room_id,
    p_content,
    v_is_owner,
    p_conversation_id,
    p_reply_to_message_id
  )
  RETURNING
    messages.id,
    messages.room_id,
    messages.conversation_id,
    messages.content,
    messages.is_owner,
    messages.created_at,
    messages.reply_to_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION send_message_secure(TEXT, UUID, TEXT, UUID, TEXT) TO anon;