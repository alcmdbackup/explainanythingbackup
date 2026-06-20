-- Phase 2 (groups_of_judges_make_up_indecisiveness_evolution_20260611): judge-ensemble escalation.
-- A judge_eval_calls row becomes one SUBMATCH within an escalation chain; rows are grouped into a
-- "match" by submatch_group_key. A chain (ordered models per mode + aggregation rule) is a reusable
-- config record, referenced by the sweep run. All changes are additive + idempotent (legacy
-- single-judge rows keep NULL submatch columns and read unchanged).

-- --- Submatch identity on each judge_eval_calls row ---------------------------------------------
ALTER TABLE judge_eval_calls ADD COLUMN IF NOT EXISTS submatch_group_key TEXT;
ALTER TABLE judge_eval_calls ADD COLUMN IF NOT EXISTS escalation_step INT;
ALTER TABLE judge_eval_calls ADD COLUMN IF NOT EXISTS triggered_escalation BOOLEAN;
-- Chains mix models, so the per-submatch model must live on the call row (the run no longer has a
-- single judge_model for escalation sweeps). Denormalized for "model X as the Nth-in-chain" analytics.
ALTER TABLE judge_eval_calls ADD COLUMN IF NOT EXISTS judge_model TEXT;

CREATE INDEX IF NOT EXISTS idx_judge_eval_calls_submatch_group
  ON judge_eval_calls (submatch_group_key) WHERE submatch_group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_judge_eval_calls_judge_model
  ON judge_eval_calls (judge_model) WHERE judge_model IS NOT NULL;

-- --- Escalation-chain config (reusable named chain: ordered models per mode + rule + cap) --------
CREATE TABLE IF NOT EXISTS judge_eval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  article_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  paragraph_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  aggregation_rule TEXT NOT NULL DEFAULT 'first_decisive',
  aggregation_rule_version INT NOT NULL DEFAULT 1,
  cap INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE judge_eval_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "judge_eval_chains_service_role_all" ON judge_eval_chains;
CREATE POLICY "judge_eval_chains_service_role_all" ON judge_eval_chains
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON judge_eval_chains FROM PUBLIC;
REVOKE ALL ON judge_eval_chains FROM anon;
REVOKE ALL ON judge_eval_chains FROM authenticated;
GRANT ALL ON judge_eval_chains TO service_role;

-- --- Link a sweep run to its chain + aggregation rule -------------------------------------------
ALTER TABLE judge_eval_runs ADD COLUMN IF NOT EXISTS chain_id UUID
  REFERENCES judge_eval_chains (id) ON DELETE SET NULL;
ALTER TABLE judge_eval_runs ADD COLUMN IF NOT EXISTS aggregation_rule TEXT;
ALTER TABLE judge_eval_runs ADD COLUMN IF NOT EXISTS aggregation_rule_version INT;
