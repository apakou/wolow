-- Push notification subscriptions (Web Push API)
-- Keyed by room + role, matching the anonymous token auth model.

CREATE TABLE push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'visitor')),
  endpoint        TEXT NOT NULL,
  p256dh          TEXT NOT NULL,
  auth_key        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

-- Owner lookup: find all owner subscriptions for a room
CREATE INDEX idx_push_subs_room_role ON push_subscriptions (room_id, role);

-- Visitor lookup: find visitor subscriptions for a conversation
CREATE INDEX idx_push_subs_conv_role ON push_subscriptions (conversation_id, role)
  WHERE conversation_id IS NOT NULL;

-- RLS: permissive (real auth enforced in API layer, same as messages/conversations)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_select_all ON push_subscriptions
  FOR SELECT USING (true);

CREATE POLICY push_subscriptions_insert_all ON push_subscriptions
  FOR INSERT WITH CHECK (true);

CREATE POLICY push_subscriptions_delete_all ON push_subscriptions
  FOR DELETE USING (true);

-- Allow upsert (ON CONFLICT ... DO UPDATE)
CREATE POLICY push_subscriptions_update_all ON push_subscriptions
  FOR UPDATE USING (true);
