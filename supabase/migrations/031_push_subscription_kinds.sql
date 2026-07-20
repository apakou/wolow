-- Mobile push: extend push_subscriptions to carry FCM device tokens
-- alongside Web Push subscriptions.
--
-- kind = 'webpush' -> endpoint is a Web Push endpoint URL, p256dh/auth_key set
-- kind = 'fcm'     -> endpoint is an FCM registration token, p256dh/auth_key NULL
--
-- The UNIQUE(endpoint) constraint holds for both kinds (FCM tokens are unique),
-- so the upsert-by-endpoint flow in the API keeps working unchanged.

ALTER TABLE push_subscriptions
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'webpush'
  CHECK (kind IN ('webpush', 'fcm'));

-- FCM rows have no Web Push crypto keys.
ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions ALTER COLUMN auth_key DROP NOT NULL;

-- Web Push rows must still carry their keys (backstop for API bugs).
ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_webpush_keys_check
  CHECK (kind <> 'webpush' OR (p256dh IS NOT NULL AND auth_key IS NOT NULL));
