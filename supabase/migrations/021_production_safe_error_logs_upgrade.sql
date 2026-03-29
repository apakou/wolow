-- ============================================================
-- 021_production_safe_error_logs_upgrade.sql
-- Non-destructive production-safe migration for error logging.
-- This migration is idempotent and does not delete application data.
-- ============================================================

-- Ensure UUID generation is available for default IDs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Ensure table exists.
CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT,
  level TEXT,
  message TEXT,
  stack TEXT,
  endpoint TEXT,
  method TEXT,
  status_code INTEGER,
  slug TEXT,
  user_agent TEXT,
  ip TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 2) Ensure required columns exist (safe when table already exists).
ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS level TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS stack TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS method TEXT,
  ADD COLUMN IF NOT EXISTS status_code INTEGER,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS ip TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 3) Backfill NULLs before adding/strengthening constraints.
UPDATE public.error_logs
SET
  created_at = COALESCE(created_at, now()),
  source = COALESCE(source, 'server'),
  level = COALESCE(level, 'error'),
  message = COALESCE(NULLIF(message, ''), 'Unknown error'),
  metadata = COALESCE(metadata, '{}'::jsonb)
WHERE
  created_at IS NULL
  OR source IS NULL
  OR level IS NULL
  OR message IS NULL
  OR message = ''
  OR metadata IS NULL;

-- 4) Enforce defaults and NOT NULL constraints (non-destructive).
ALTER TABLE public.error_logs
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN level SET DEFAULT 'error',
  ALTER COLUMN level SET NOT NULL,
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN message SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- 5) Ensure check constraints exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'error_logs_source_check'
      AND conrelid = 'public.error_logs'::regclass
  ) THEN
    ALTER TABLE public.error_logs
      ADD CONSTRAINT error_logs_source_check
      CHECK (source IN ('client', 'server'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'error_logs_level_check'
      AND conrelid = 'public.error_logs'::regclass
  ) THEN
    ALTER TABLE public.error_logs
      ADD CONSTRAINT error_logs_level_check
      CHECK (level IN ('error', 'warn', 'info'));
  END IF;
END
$$;

-- 6) Ensure indexes exist.
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
  ON public.error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_source
  ON public.error_logs (source);

CREATE INDEX IF NOT EXISTS idx_error_logs_slug
  ON public.error_logs (slug)
  WHERE slug IS NOT NULL;

-- 7) Keep helper function up to date.
CREATE OR REPLACE FUNCTION public.prune_old_error_logs()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.error_logs
  WHERE created_at < now() - interval '30 days';
$$;

-- 8) Upsert RPC for inserts from API/client.
CREATE OR REPLACE FUNCTION public.insert_error_log(
  p_source      TEXT,
  p_level       TEXT DEFAULT 'error',
  p_message     TEXT DEFAULT '',
  p_stack       TEXT DEFAULT NULL,
  p_endpoint    TEXT DEFAULT NULL,
  p_method      TEXT DEFAULT NULL,
  p_status_code INTEGER DEFAULT NULL,
  p_slug        TEXT DEFAULT NULL,
  p_user_agent  TEXT DEFAULT NULL,
  p_ip          TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.error_logs (
    source,
    level,
    message,
    stack,
    endpoint,
    method,
    status_code,
    slug,
    user_agent,
    ip,
    metadata
  )
  VALUES (
    CASE WHEN p_source IN ('client', 'server') THEN p_source ELSE 'server' END,
    CASE WHEN p_level IN ('error', 'warn', 'info') THEN p_level ELSE 'error' END,
    left(COALESCE(NULLIF(p_message, ''), 'Unknown error'), 2000),
    left(p_stack, 4000),
    left(p_endpoint, 500),
    p_method,
    p_status_code,
    p_slug,
    left(p_user_agent, 500),
    p_ip,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_error_log(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) TO anon, authenticated;

-- 9) Ensure RLS and read policy for service role.
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'error_logs'
      AND policyname = 'error_logs_read_admin'
  ) THEN
    CREATE POLICY error_logs_read_admin
      ON public.error_logs
      FOR SELECT
      USING (auth.role() = 'service_role');
  END IF;
END
$$;
