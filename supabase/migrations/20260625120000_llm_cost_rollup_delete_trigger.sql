-- Fix the rollup-drift bug observed during PR #1281 finalization: the existing
-- `llm_cost_rollup_trigger` (migration 20260228000001) is AFTER INSERT only, so cleanup
-- jobs that DELETE rows from "llmCallTracking" silently leave the
-- daily_cost_rollups.total_cost_usd counter holding their cost. On staging this drift had
-- accumulated to $51.70 (vs $0.004 actual) over 5 days, blocking every non-evolution LLM
-- call because the LLMSpendingGate's daily cap kicked in. See:
--   docs/analysis/wi_holistic_prompt_priming/README.md (mentioned as follow-up)
--   migration 20260228000001_add_llm_cost_security.sql (the AFTER INSERT trigger)
--
-- Symmetric AFTER DELETE trigger so:
--   INSERT row → total_cost_usd += row.estimated_cost_usd   (existing)
--   DELETE row → total_cost_usd -= row.estimated_cost_usd   (new)
-- Call_count is similarly decremented. The GREATEST(0, …) guard prevents negative values
-- if rows were ever deleted out-of-order with their corresponding INSERTs (shouldn't
-- happen given the AFTER INSERT timing, but defensive).

BEGIN;

SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION decrement_daily_cost_rollup() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE daily_cost_rollups
  SET
    total_cost_usd = GREATEST(0, total_cost_usd - COALESCE(OLD.estimated_cost_usd, 0)),
    call_count = GREATEST(0, call_count - 1)
  WHERE date = OLD.created_at::date
    AND category = CASE WHEN OLD.call_source LIKE 'evolution_%' THEN 'evolution' ELSE 'non_evolution' END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS llm_cost_rollup_delete_trigger ON "llmCallTracking";
CREATE TRIGGER llm_cost_rollup_delete_trigger
  AFTER DELETE ON "llmCallTracking"
  FOR EACH ROW EXECUTE FUNCTION decrement_daily_cost_rollup();

COMMENT ON FUNCTION decrement_daily_cost_rollup() IS
  'Symmetric counterpart to update_daily_cost_rollup() — decrements daily_cost_rollups when a row leaves "llmCallTracking" (cleanup jobs, manual deletes). Prevents the rollup-poisoning bug that caused $51.70 ghost-spend on staging.';

COMMIT;
