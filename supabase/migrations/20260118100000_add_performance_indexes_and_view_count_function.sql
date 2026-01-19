-- Migration: Add performance indexes and server-side view count aggregation
-- Purpose: Optimize getRecentExplanations "top" mode by moving aggregation to database
-- Rollback: DROP FUNCTION IF EXISTS get_explanation_view_counts; DROP INDEX IF EXISTS idx_user_explanation_events_explanationid_eventname; DROP INDEX IF EXISTS idx_explanations_status_timestamp;

-- =============================================================================
-- 2.3 PERFORMANCE INDEXES
-- =============================================================================

-- Index for efficient view count aggregation: GROUP BY explanationid WHERE event_name = 'explanation_viewed'
-- This supports the get_explanation_view_counts function below
CREATE INDEX IF NOT EXISTS idx_user_explanation_events_explanationid_eventname
ON "userExplanationEvents" (explanationid, event_name);

-- Index for efficient recent published explanations query
-- Used by: getRecentExplanations with status='published' ORDER BY timestamp
CREATE INDEX IF NOT EXISTS idx_explanations_status_timestamp
ON explanations (status, timestamp DESC);

-- =============================================================================
-- 2.2 SERVER-SIDE VIEW COUNT AGGREGATION FUNCTION
-- =============================================================================

-- Function to get view counts for explanations within a time period
-- This replaces client-side Map aggregation with efficient database GROUP BY
--
-- Parameters:
--   p_period: 'hour', 'today', 'week', 'month', 'all'
--   p_limit: max number of results (default 100)
--
-- Returns: Table of (explanationid, view_count) ordered by view_count DESC
CREATE OR REPLACE FUNCTION get_explanation_view_counts(
  p_period TEXT DEFAULT 'week',
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  explanationid INT,
  view_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- Calculate cutoff date based on period
  v_cutoff := CASE p_period
    WHEN 'hour' THEN NOW() - INTERVAL '1 hour'
    WHEN 'today' THEN NOW() - INTERVAL '1 day'
    WHEN 'week' THEN NOW() - INTERVAL '7 days'
    WHEN 'month' THEN NOW() - INTERVAL '30 days'
    WHEN 'all' THEN NULL
    ELSE NOW() - INTERVAL '7 days'  -- Default to week
  END;

  -- Return aggregated view counts
  IF v_cutoff IS NULL THEN
    -- All time: no date filter
    RETURN QUERY
    SELECT
      e.explanationid,
      COUNT(*)::BIGINT as view_count
    FROM "userExplanationEvents" e
    WHERE e.event_name = 'explanation_viewed'
    GROUP BY e.explanationid
    ORDER BY view_count DESC
    LIMIT p_limit;
  ELSE
    -- Time-filtered query
    RETURN QUERY
    SELECT
      e.explanationid,
      COUNT(*)::BIGINT as view_count
    FROM "userExplanationEvents" e
    WHERE e.event_name = 'explanation_viewed'
      AND e.created_at >= v_cutoff
    GROUP BY e.explanationid
    ORDER BY view_count DESC
    LIMIT p_limit;
  END IF;
END;
$$;

-- Grant execute to authenticated users (same as other RPC functions)
GRANT EXECUTE ON FUNCTION get_explanation_view_counts(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_explanation_view_counts(TEXT, INT) TO anon;
GRANT EXECUTE ON FUNCTION get_explanation_view_counts(TEXT, INT) TO service_role;

-- Comment for documentation
COMMENT ON FUNCTION get_explanation_view_counts IS 'Returns view counts by explanation for the specified time period. Used by Explore page "Top" mode. Period options: hour, today, week, month, all.';
