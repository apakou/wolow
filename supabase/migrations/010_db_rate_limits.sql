-- A04: Shared rate-limit store for serverless deployments.
-- Replaces the per-process in-memory Map so all Vercel function instances
-- enforce a single consistent limit using PostgreSQL row-level locking.

CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT    PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 1,
  window_start BIGINT  NOT NULL        -- epoch milliseconds
);

-- No RLS policies: table is inaccessible to anon/authenticated roles directly.
-- All access goes through the SECURITY DEFINER functions below.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- ─── Atomic check-and-increment ─────────────────────────────────────────────
-- Returns (allowed, current_count, retry_after_ms).
-- Uses INSERT … ON CONFLICT to atomically handle new vs existing windows.
CREATE OR REPLACE FUNCTION check_and_increment_rate_limit(
  p_key       TEXT,
  p_limit     INTEGER,
  p_window_ms BIGINT
)
RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, retry_after_ms BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
  v_new_count  INTEGER;
  v_win_start  BIGINT;
BEGIN
  INSERT INTO rate_limits (key, count, window_start)
  VALUES (p_key, 1, v_now)
  ON CONFLICT (key) DO UPDATE
    SET
      count        = CASE
                       WHEN rate_limits.window_start + p_window_ms <= v_now THEN 1
                       ELSE rate_limits.count + 1
                     END,
      window_start = CASE
                       WHEN rate_limits.window_start + p_window_ms <= v_now THEN v_now
                       ELSE rate_limits.window_start
                     END
  RETURNING rate_limits.count, rate_limits.window_start
    INTO v_new_count, v_win_start;

  IF v_new_count > p_limit THEN
    RETURN QUERY SELECT FALSE, v_new_count, (v_win_start + p_window_ms - v_now);
  ELSE
    RETURN QUERY SELECT TRUE,  v_new_count, 0::BIGINT;
  END IF;
END;
$$;

-- Allow the server's anon-key client to call the function.
GRANT EXECUTE ON FUNCTION check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO anon;

-- ─── Periodic cleanup ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prune_expired_rate_limits(p_window_ms BIGINT)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM rate_limits
  WHERE window_start + p_window_ms
        < (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
$$;

GRANT EXECUTE ON FUNCTION prune_expired_rate_limits(BIGINT) TO anon;
