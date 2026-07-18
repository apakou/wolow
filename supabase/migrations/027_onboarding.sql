-- ============================================================
-- 027_onboarding.sql
-- Onboarding flow support (NGL-style /welcome wizard).
--
--   1. rooms.onboarding_completed_at — NULL means the owner hasn't
--      finished the /welcome flow yet. Backfilled with now() for all
--      existing rooms so current users never see onboarding.
--
--   2. RLS: allow the authenticated owner (auth.uid() = user_id) to
--      UPDATE their own room. The pre-existing policy
--      "rooms_update_owner_only" matches on
--      current_setting('app.owner_token') which the app never sets,
--      so authenticated updates silently matched 0 rows until now.
--
--   3. Slug format backstop: charset + length CHECK so direct-DB
--      writers can't store garbage slugs. NOT VALID grandfathers any
--      legacy rows; product rules (lowercase, reserved names, 3–20)
--      are enforced in the API layer.
-- ============================================================

-- ──────────────────────────────────────────
-- 1. Onboarding flag
-- ──────────────────────────────────────────

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Existing rooms predate the onboarding flow — mark them complete.
UPDATE rooms
SET onboarding_completed_at = now()
WHERE onboarding_completed_at IS NULL;

-- ──────────────────────────────────────────
-- 2. Authenticated-owner update policy
-- ──────────────────────────────────────────

DROP POLICY IF EXISTS "rooms_update_owner_user" ON rooms;

CREATE POLICY "rooms_update_owner_user"
  ON rooms FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ──────────────────────────────────────────
-- 3. Slug charset/length backstop
-- ──────────────────────────────────────────

ALTER TABLE rooms
  ADD CONSTRAINT rooms_slug_format
  CHECK (slug ~ '^[A-Za-z0-9_-]{3,32}$')
  NOT VALID;
