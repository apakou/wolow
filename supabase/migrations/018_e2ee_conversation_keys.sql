-- E2EE key columns: store RSA-OAEP public keys alongside rooms and conversations.
-- Private keys stay in the browser (IndexedDB) and never leave the device.

-- Owner's public key — one per room
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS owner_public_key JSONB;

-- Visitor's public key — one per conversation
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS visitor_public_key JSONB;
