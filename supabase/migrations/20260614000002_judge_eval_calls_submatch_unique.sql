-- Phase 2 (groups_of_judges_make_up_indecisiveness_evolution_20260611): the original
-- judge_eval_calls UNIQUE (eval_run_id, pair_label, repeat_index) assumed ONE row per (pair, repeat)
-- — true for single-judge runs, but an escalation match has 1-3 SUBMATCH rows sharing that key
-- (distinguished by escalation_step). Replace the table-wide unique constraint with two PARTIAL
-- unique indexes: single-judge rows keep the original uniqueness; escalation rows are unique per
-- (run, pair, repeat, escalation_step). Idempotent + preserves single-judge protection.

ALTER TABLE judge_eval_calls
  DROP CONSTRAINT IF EXISTS judge_eval_calls_eval_run_id_pair_label_repeat_index_key;

-- Single-judge / legacy rows (no submatch grouping): one row per (run, pair, repeat).
CREATE UNIQUE INDEX IF NOT EXISTS judge_eval_calls_single_judge_uniq
  ON judge_eval_calls (eval_run_id, pair_label, repeat_index)
  WHERE submatch_group_key IS NULL;

-- Escalation submatches: one row per (run, pair, repeat, escalation_step).
CREATE UNIQUE INDEX IF NOT EXISTS judge_eval_calls_submatch_uniq
  ON judge_eval_calls (eval_run_id, pair_label, repeat_index, escalation_step)
  WHERE submatch_group_key IS NOT NULL;
