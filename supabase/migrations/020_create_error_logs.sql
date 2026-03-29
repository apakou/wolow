-- ============================================================
-- 020_create_error_logs.sql
-- Persistent error log table for client-side and server-side errors.
-- Used for bug investigation and proactive issue resolution.
-- ============================================================

CREATE TABLE IF NOT EXISTS error_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Where the error originated
  source      TEXT NOT NULL CHECK (source IN ('client', 'server')),

  -- Severity level
  level       TEXT NOT NULL DEFAULT 'error' CHECK (level IN ('error', 'warn', 'info')),

  -- Error details
  message     TEXT NOT NULL,
  stack       TEXT,                 -- stack trace (truncated on insert)

  -- Context
  endpoint    TEXT,                 -- API route or page path
  method      TEXT,                 -- HTTP method (GET, POST, etc.)
  status_code INTEGER,             -- HTTP status code if applicable
  slug        TEXT,                 -- room slug for correlation
  user_agent  TEXT,                 -- browser user-agent (no PII)
  ip          TEXT,                 -- client IP for abuse correlation (rotated)

  -- Flexible metadata bag for extra context
  metadata    JSONB DEFAULT '{}'::jsonb
);

-- Index for querying recent errors efficiently
CREATE INDEX idx_error_logs_created_at ON error_logs (created_at DESC);
CREATE INDEX idx_error_logs_source     ON error_logs (source);
CREATE INDEX idx_error_logs_slug       ON error_logs (slug) WHERE slug IS NOT NULL;

-- Auto-prune old logs (keep 30 days) to prevent unbounded growth
CREATE OR REPLACE FUNCTION prune_old_error_logs()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM error_logs WHERE created_at < now() - interval '30 days';
$$;

-- RPC for inserting error logs (callable by anon role via API)
CREATE OR REPLACE FUNCTION insert_error_log(
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
  INSERT INTO error_logs (
    source, level, message, stack, endpoint, method,
    status_code, slug, user_agent, ip, metadata
  )
  VALUES (
    p_source, p_level,
    left(p_message, 2000),      -- cap message at 2000 chars
    left(p_stack, 4000),        -- cap stack at 4000 chars
    left(p_endpoint, 500),
    p_method,
    p_status_code,
    p_slug,
    left(p_user_agent, 500),
    p_ip,
    p_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION insert_error_log TO anon;
GRANT EXECUTE ON FUNCTION insert_error_log TO authenticated;

-- RLS: error_logs is write-only via RPC; no direct SELECT for anon
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Only service_role (dashboard / admin) can read logs directly
CREATE POLICY error_logs_read_admin
  ON error_logs FOR SELECT
  USING (auth.role() = 'service_role');
