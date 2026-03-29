-- Add media_url column to messages for image attachments
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Create the storage bucket for chat media (public read, authenticated upload)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read files from the bucket (public)
DROP POLICY IF EXISTS "chat_media_public_read" ON storage.objects;
CREATE POLICY "chat_media_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media');

-- Anyone can upload files to the bucket (anonymous chat users)
DROP POLICY IF EXISTS "chat_media_anon_insert" ON storage.objects;
CREATE POLICY "chat_media_anon_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-media');

-- Drop old function signatures before recreating with new parameter
DROP FUNCTION IF EXISTS send_message_secure(TEXT, UUID, TEXT, UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS send_message_secure(TEXT, UUID, TEXT, UUID, TEXT);

-- Update send_message_secure RPC to accept media_url
CREATE OR REPLACE FUNCTION send_message_secure(
  p_slug           TEXT,
  p_conversation_id UUID,
  p_content        TEXT,
  p_reply_to_message_id UUID DEFAULT NULL,
  p_owner_token    TEXT DEFAULT NULL,
  p_encrypted_content TEXT DEFAULT NULL,
  p_sender_public_key_id UUID DEFAULT NULL,
  p_media_url      TEXT DEFAULT NULL
)
RETURNS SETOF messages
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room         RECORD;
  v_is_owner     BOOLEAN;
  v_reply_conv   UUID;
BEGIN
  -- Look up room
  SELECT id, owner_token INTO v_room
  FROM rooms
  WHERE slug = p_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  -- Verify the conversation exists and belongs to this room
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_REQUIRED';
  END IF;

  PERFORM 1 FROM conversations
  WHERE id = p_conversation_id AND room_id = v_room.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND';
  END IF;

  -- Determine ownership
  v_is_owner := (p_owner_token IS NOT NULL AND p_owner_token = v_room.owner_token);

  -- Validate reply target
  IF p_reply_to_message_id IS NOT NULL THEN
    SELECT conversation_id INTO v_reply_conv
    FROM messages
    WHERE id = p_reply_to_message_id AND room_id = v_room.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REPLY_TARGET_NOT_FOUND';
    END IF;

    IF v_reply_conv IS DISTINCT FROM p_conversation_id THEN
      RAISE EXCEPTION 'REPLY_TARGET_WRONG_CONVERSATION';
    END IF;
  END IF;

  -- Insert and return
  RETURN QUERY
  INSERT INTO messages (room_id, conversation_id, content, is_owner, reply_to_message_id,
                        encrypted_content, sender_public_key_id, media_url)
  VALUES (v_room.id, p_conversation_id, p_content, v_is_owner, p_reply_to_message_id,
          p_encrypted_content, p_sender_public_key_id, p_media_url)
  RETURNING *;

  -- Touch conversation timestamp
  UPDATE conversations SET updated_at = NOW() WHERE id = p_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION send_message_secure TO anon;
GRANT EXECUTE ON FUNCTION send_message_secure TO authenticated;
